/**
 * Analytics tool: Contention rate by route + time (FR21).
 *
 * Computes: COUNT(HOLD_FAILED) / COUNT(HOLD_SUCCESS + HOLD_FAILED) from AuditLog,
 * grouped by (origin, destination, departureTime, dayOfWeek).
 *
 * This is the CRITICAL signal for "demand that was turned away" — distinct from
 * "demand that was met". A trip that's merely full (HOLD_FAILED=0) is right-sized.
 * A trip that's full AND generates repeated HOLD_FAILED entries is undersupplied.
 *
 * The analytics agent is instructed to ONLY recommend ADD_TRIP/INCREASE_CAPACITY
 * when BOTH high utilization (tool 1) AND high contention (this tool) are present.
 * Contention alone without utilization could mean seats are still being held + released
 * rather than genuinely fully booked.
 */

const prisma = require("../../../config/prisma");

const MAX_LOOKBACK_WEEKS = 8;

async function getContentionRate({ lookbackWeeks }) {
  const weeks = Math.min(lookbackWeeks ?? 4, MAX_LOOKBACK_WEEKS);
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);

  // Get all hold audit logs in range, joined to their seat+trip for grouping
  const logs = await prisma.auditLog.findMany({
    where: {
      action: { in: ["HOLD_SUCCESS", "HOLD_FAILED"] },
      createdAt: { gte: since },
      seatId: { not: null },
    },
    select: {
      action: true,
      seatId: true,
      createdAt: true,
      metadata: true,
    },
  });

  // We need trip info per seat — batch fetch all involved seats
  const seatIds = [...new Set(logs.map((l) => l.seatId).filter(Boolean))];
  const seats = await prisma.seat.findMany({
    where: { id: { in: seatIds } },
    include: { trip: { select: { origin: true, destination: true, departureTime: true, date: true } } },
  });
  const seatMap = Object.fromEntries(seats.map((s) => [s.id, s]));

  const groups = {};
  for (const log of logs) {
    const seat = seatMap[log.seatId];
    if (!seat) continue;
    const dow = new Date(seat.trip.date).getDay() || 7;
    const key = `${seat.trip.origin}|${seat.trip.destination}|${seat.trip.departureTime}|${dow}`;
    if (!groups[key]) {
      groups[key] = {
        origin: seat.trip.origin,
        destination: seat.trip.destination,
        departureTime: seat.trip.departureTime,
        dayOfWeek: dow,
        holdSuccess: 0,
        holdFailed: 0,
      };
    }
    if (log.action === "HOLD_SUCCESS") groups[key].holdSuccess++;
    if (log.action === "HOLD_FAILED") groups[key].holdFailed++;
  }

  return Object.values(groups).map((g) => {
    const total = g.holdSuccess + g.holdFailed;
    return {
      ...g,
      totalAttempts: total,
      contentionRate: total > 0 ? +(g.holdFailed / total).toFixed(4) : 0,
    };
  }).sort((a, b) => b.contentionRate - a.contentionRate);
}

module.exports = { getContentionRate };
