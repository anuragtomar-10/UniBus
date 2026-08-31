/**
 * Trips service — search and seat map.
 *
 * Passive reconciliation for expired holds (LLD §1):
 *   Chosen over active Redis keyspace-notification pub/sub — simpler, no long-lived
 *   subscriber process, and the staleness window is bounded and harmless.
 *   On any read that touches a HELD seat, we check if the Redis key still exists.
 *   If not, we flip Postgres back to AVAILABLE and emit seat:released right there,
 *   before returning results. This means seat:released is emitted as a side-effect
 *   of the next read — EC5 is satisfied without requiring any live client connection.
 */

const prisma = require("../../config/prisma");
const redis = require("../../config/redis");
const { emitSeatReleased } = require("../../sockets/emitters");

/**
 * FR10: Search trips by date, time (optional), and destination.
 * FR7: Only current week's trips returned (no past or future week data).
 * Results include full origin → destination per trip.
 */
async function searchTrips({ date, time, destination }) {
  if (!date) {
    const err = new Error("date is required");
    err.status = 400;
    throw err;
  }

  // Current week = Mon of this week through Sat
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const dow = today.getDay(); // 0=Sun
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);

  // FR7: EC4 — if admin hasn't refreshed, search returns empty results (no auto-fallback)
  if (d < monday || d > saturday) {
    return [];
  }

  const where = { date: d };
  if (destination) where.destination = destination;
  if (time) where.departureTime = time;

  const trips = await prisma.trip.findMany({
    where,
    include: {
      bus: true,
      driver: true,
      seats: { orderBy: { seatNumber: "asc" } },
    },
    orderBy: { departureTime: "asc" },
  });

  const now = new Date();

  // Attach available seat count and filter out past trips
  return trips
    .filter((trip) => {
      const [hours, minutes] = trip.departureTime.split(":");
      const tripDateTime = new Date(trip.date);
      tripDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      return tripDateTime > now;
    })
    .map((trip) => ({
      ...trip,
      availableSeats: trip.seats.filter((s) => s.status === "AVAILABLE").length,
      totalSeats: trip.seats.length,
    }));
}

/**
 * FR11: Get seat map for a trip.
 * Runs passive reconciliation on HELD seats before returning (EC5, LLD §1).
 */
async function getSeatMap(tripId) {
  const trip = await prisma.trip.findUnique({
    where: { id: tripId },
    include: {
      seats: { orderBy: { seatNumber: "asc" } },
      bus: true,
      driver: true,
    },
  });

  if (!trip) {
    const err = new Error("Trip not found");
    err.status = 404;
    throw err;
  }

  // Passive reconciliation: check all HELD seats
  const heldSeats = trip.seats.filter((s) => s.status === "HELD");
  const reconciliationUpdates = [];

  for (const seat of heldSeats) {
    const redisKey = `seat:${tripId}:${seat.seatNumber}`;
    const holder = await redis.get(redisKey);

    if (!holder) {
      // Redis TTL expired — flip seat back to AVAILABLE (EC5)
      reconciliationUpdates.push(
        prisma.seat.update({
          where: { id: seat.id },
          data: { status: "AVAILABLE" },
        })
      );
      seat.status = "AVAILABLE"; // Update in-memory for the response
      emitSeatReleased(tripId, seat.seatNumber); // Notify all clients in the room
    }
  }

  if (reconciliationUpdates.length > 0) {
    await Promise.all(reconciliationUpdates);
  }

  return {
    trip: { ...trip, seats: undefined },
    seats: trip.seats,
  };
}

/**
 * Return all trips for the current Mon–Sat week, grouped by date.
 * Used by the weekly schedule view on the home page.
 */
async function getWeeklyTrips() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const saturday = new Date(monday);
  saturday.setDate(monday.getDate() + 5);

  const trips = await prisma.trip.findMany({
    where: { date: { gte: monday, lte: saturday } },
    include: { bus: true, driver: true, seats: true },
    orderBy: [{ date: "asc" }, { departureTime: "asc" }],
  });

  // Group by local date string (YYYY-MM-DD) to avoid UTC midnight shifting
  const grouped = {};
  const now = new Date();

  for (const trip of trips) {
    const [hours, minutes] = trip.departureTime.split(":");
    const tripDateTime = new Date(trip.date);
    tripDateTime.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);

    // Filter out trips that have already left
    if (tripDateTime <= now) {
      continue;
    }

    const y = trip.date.getFullYear();
    const m = String(trip.date.getMonth() + 1).padStart(2, "0");
    const d = String(trip.date.getDate()).padStart(2, "0");
    const key = `${y}-${m}-${d}`;
    
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push({
      ...trip,
      availableSeats: trip.seats.filter((s) => s.status === "AVAILABLE").length,
      totalSeats: trip.seats.length,
    });
  }

  return grouped;
}

module.exports = { searchTrips, getSeatMap, getWeeklyTrips };
