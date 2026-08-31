/**
 * Analytics tool: Utilization by route + time (FR20).
 *
 * Computes: SUM(bookedSeats) / SUM(totalSeats) for each
 * (origin, destination, departureTime, dayOfWeek) over the lookback window.
 *
 * This is a deterministic Prisma aggregate — no LLM involved.
 * The LLM's job is synthesis/prioritization of the numbers; the arithmetic
 * is always computed by this function, never estimated by the model.
 *
 * A slot with high utilization alone does NOT justify ADD_TRIP — you also
 * need high contention (HOLD_FAILED) to confirm demand was turned away (EC12).
 * Both ends of the result (full slots AND empty slots) are actionable in
 * opposite directions.
 */

const prisma = require("../../../config/prisma");

const MAX_LOOKBACK_WEEKS = 8; // NFR15: hard cap regardless of what the request body sends

async function getUtilizationByRouteTime({ lookbackWeeks }) {
  // EC15: silently clamp to max, never reject with an error
  const weeks = Math.min(lookbackWeeks ?? 4, MAX_LOOKBACK_WEEKS);
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);

  const trips = await prisma.trip.findMany({
    where: { date: { gte: since } },
    include: {
      bus: { select: { totalSeats: true } },
      seats: { select: { status: true } },
    },
  });

  // Group by (origin, destination, departureTime, dayOfWeek)
  const groups = {};
  for (const trip of trips) {
    const dow = new Date(trip.date).getDay() || 7; // ISO: 1=Mon..7=Sun, exclude 7
    const key = `${trip.origin}|${trip.destination}|${trip.departureTime}|${dow}`;
    if (!groups[key]) {
      groups[key] = {
        origin: trip.origin,
        destination: trip.destination,
        departureTime: trip.departureTime,
        dayOfWeek: dow,
        totalSeats: 0,
        bookedSeats: 0,
        tripCount: 0,
      };
    }
    const g = groups[key];
    g.totalSeats += trip.bus.totalSeats;
    g.bookedSeats += trip.seats.filter((s) => s.status === "BOOKED").length;
    g.tripCount++;
  }

  return Object.values(groups)
    .map((g) => ({
      ...g,
      utilization: g.totalSeats > 0 ? +(g.bookedSeats / g.totalSeats).toFixed(4) : 0,
    }))
    .sort((a, b) => b.utilization - a.utilization);
}

module.exports = { getUtilizationByRouteTime };
