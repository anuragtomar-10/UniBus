/**
 * Analytics tool: Special trip frequency by route + time (FR23).
 *
 * Counts Trip rows with source=SPECIAL, grouped by
 * (origin, destination, departureTime, dayOfWeek), over the lookback window.
 *
 * Why this matters:
 *   Each special trip represents an admin manually patching a gap in the base schedule.
 *   A slot that keeps getting manually patched is itself evidence the base schedule is
 *   wrong for that slot — the system is learning from the admin's own corrective behavior.
 *
 * Used together with utilization (tool 1) to guard REMOVE_FROM_BASE (EC13):
 *   - Low utilization + LOW special frequency → REMOVE_FROM_BASE is safe
 *   - Low utilization + HIGH special frequency → slot is only busy during peaks
 *     (e.g. exam weeks) → do NOT recommend REMOVE_FROM_BASE
 */

const prisma = require("../../../config/prisma");

const MAX_LOOKBACK_WEEKS = 8;

async function getSpecialTripFrequency({ lookbackWeeks }) {
  const weeks = Math.min(lookbackWeeks ?? 4, MAX_LOOKBACK_WEEKS);
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);

  const specials = await prisma.trip.findMany({
    where: { source: "SPECIAL", date: { gte: since } },
  });

  const groups = {};
  for (const trip of specials) {
    const dow = new Date(trip.date).getDay() || 7;
    const key = `${trip.origin}|${trip.destination}|${trip.departureTime}|${dow}`;
    if (!groups[key]) {
      groups[key] = {
        origin: trip.origin,
        destination: trip.destination,
        departureTime: trip.departureTime,
        dayOfWeek: dow,
        specialTripCount: 0,
      };
    }
    groups[key].specialTripCount++;
  }

  return Object.values(groups).sort((a, b) => b.specialTripCount - a.specialTripCount);
}

module.exports = { getSpecialTripFrequency };
