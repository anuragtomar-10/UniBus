/**
 * Recommendation persistence service.
 *
 * Validates each recommendation from the agent before writing to the DB:
 *   - `evidence`        must be a non-empty string (NFR14)
 *   - `suggestedAction` must be one of the allowed enum values (NFR14)
 *   - `tripType`        must be a valid enum value
 *
 * Invalid recommendations are dropped (not rejected entirely) so that a
 * partially-valid agent response still produces actionable output.
 */

const prisma = require("../../config/prisma");

const ALLOWED_ACTIONS = [
  "ADD_TO_BASE",
  "REMOVE_FROM_BASE",
  "INCREASE_FREQUENCY",
  "DECREASE_FREQUENCY",
  "INVESTIGATE_CANCELLATIONS",
];

const ALLOWED_TRIP_TYPES = ["BASE", "SPECIAL"];

/**
 * Validate a single recommendation object returned by the agent.
 * Returns null if invalid, or the cleaned object if valid.
 */
function validateRecommendation(rec) {
  if (!rec || typeof rec !== "object") return null;

  const { origin, destination, departureTime, dayOfWeek, suggestedAction, evidence, tripType } = rec;

  // Required fields
  if (!origin || !destination || !departureTime) return null;
  if (!evidence || typeof evidence !== "string" || evidence.trim().length === 0) return null; // NFR14
  if (!ALLOWED_ACTIONS.includes(suggestedAction)) return null; // NFR14: enum-only

  // Optional but validated if present
  const resolvedTripType = ALLOWED_TRIP_TYPES.includes(tripType) ? tripType : "BASE";

  return {
    origin,
    destination,
    departureTime,
    dayOfWeek: dayOfWeek ?? null,
    suggestedAction,
    evidence: evidence.trim(),
    tripType: resolvedTripType,
    status: "PENDING",
  };
}

/**
 * Validates and bulk-inserts recommendations from the agent.
 * @param {Array} rawList - Raw recommendation objects from the agent
 * @returns {{ saved: number, skipped: number, recommendations: Array }}
 */
async function persistRecommendations(rawList) {
  if (!Array.isArray(rawList)) {
    return { saved: 0, skipped: 0, recommendations: [] };
  }

  const valid = [];
  let skipped = 0;

  for (const rec of rawList) {
    const cleaned = validateRecommendation(rec);
    if (cleaned) {
      valid.push(cleaned);
    } else {
      skipped++;
    }
  }

  if (valid.length === 0) {
    return { saved: 0, skipped, recommendations: [] };
  }

  // Bulk insert; each recommendation gets its own row
  await prisma.recommendation.createMany({ data: valid });

  // Return the freshly inserted rows (newest first)
  const inserted = await prisma.recommendation.findMany({
    orderBy: { createdAt: "desc" },
    take: valid.length,
  });

  return { saved: valid.length, skipped, recommendations: inserted };
}

/**
 * List recommendations, optionally filtered by status.
 * @param {string|undefined} status - Optional status filter (PENDING / ACCEPTED / DISMISSED)
 */
async function listRecommendations(status) {
  const where = {};
  if (status) where.status = status;
  return prisma.recommendation.findMany({ where, orderBy: { createdAt: "desc" } });
}

/**
 * Update recommendation status (ACCEPTED / DISMISSED).
 * @param {string} id
 * @param {string} status
 */
async function reviewRecommendation(id, status) {
  const ALLOWED_STATUSES = ["ACCEPTED", "DISMISSED"];
  if (!ALLOWED_STATUSES.includes(status)) {
    const err = new Error(`status must be one of: ${ALLOWED_STATUSES.join(", ")}`);
    err.status = 400;
    throw err;
  }

  return prisma.recommendation.update({
    where: { id },
    data: { status, reviewedAt: new Date() },
  });
}

module.exports = { persistRecommendations, listRecommendations, reviewRecommendation };
