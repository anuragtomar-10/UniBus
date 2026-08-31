/**
 * AuditLog service — append-only, never updated.
 *
 * Every state-changing action in UniBus is recorded here (FR16, NFR6).
 * Valid actions:
 *   HOLD_SUCCESS   — seat hold granted via Lua script
 *   HOLD_FAILED    — seat hold lost the atomic race (EC11 — distinguishes "tried and lost"
 *                    from "never tried", critical for the analytics contention metric)
 *   PAYMENT_SUCCESS — booking confirmed and payment processed
 *   PAYMENT_FAILED  — payment step failed inside the transaction
 *   CANCELLED       — booking cancelled by student
 *
 * HOLD_FAILED is the single most important signal for the analytics agent:
 * it represents demand that was turned away, not just demand that was met.
 * A trip that is merely full (booked=capacity, HOLD_FAILED=0) is right-sized.
 * A trip that is full AND generates repeated HOLD_FAILED is undersupplied.
 */

const prisma = require("../../config/prisma");

/**
 * @param {string} action - One of the action strings above
 * @param {{ userId?, seatId?, bookingId?, metadata? }} context
 */
async function createAuditLog(action, { userId, seatId, bookingId, metadata } = {}) {
  try {
    await prisma.auditLog.create({
      data: { action, userId, seatId, bookingId, metadata },
    });
  } catch (err) {
    // Audit log writes must never crash the main request flow
    console.error("AuditLog write failed:", err.message);
  }
}

module.exports = { createAuditLog };
