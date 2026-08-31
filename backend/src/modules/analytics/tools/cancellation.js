/**
 * Analytics tool: Cancellation patterns by route + time (FR22).
 *
 * Computes: COUNT(CANCELLED) / COUNT(*) on Booking, filtered by createdAt
 * (same convention as FR18/EC10 — filter window is createdAt, not cancelledAt).
 *
 * A high cancellation rate is distinct from low utilization:
 *   - Low utilization may mean people never booked → low demand
 *   - High cancellation means people WANTED the slot, booked it, then backed out
 *     → could indicate wrong departure time, exam conflict, etc.
 *   → Recommend INVESTIGATE_CANCELLATIONS rather than REMOVE_FROM_BASE
 */

const prisma = require("../../../config/prisma");

const MAX_LOOKBACK_WEEKS = 8;

async function getCancellationPatterns({ lookbackWeeks }) {
  const weeks = Math.min(lookbackWeeks ?? 4, MAX_LOOKBACK_WEEKS);
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);

  const bookings = await prisma.booking.findMany({
    where: { createdAt: { gte: since } }, // EC10: filter by createdAt, not status
    include: {
      seat: {
        include: {
          trip: { select: { origin: true, destination: true, departureTime: true, date: true } },
        },
      },
    },
  });

  const groups = {};
  for (const booking of bookings) {
    const trip = booking.seat.trip;
    const dow = new Date(trip.date).getDay() || 7;
    const key = `${trip.origin}|${trip.destination}|${trip.departureTime}|${dow}`;
    if (!groups[key]) {
      groups[key] = {
        origin: trip.origin,
        destination: trip.destination,
        departureTime: trip.departureTime,
        dayOfWeek: dow,
        total: 0,
        cancelled: 0,
      };
    }
    groups[key].total++;
    if (booking.status === "CANCELLED") groups[key].cancelled++;
  }

  return Object.values(groups).map((g) => ({
    ...g,
    cancellationRate: g.total > 0 ? +(g.cancelled / g.total).toFixed(4) : 0,
  })).sort((a, b) => b.cancellationRate - a.cancellationRate);
}

module.exports = { getCancellationPatterns };
