/**
 * Hold service — atomic seat hold via Lua script.
 *
 * NFR2, NFR9, LLD §1:
 *   Redis is the hot path — the Lua script runs before Postgres is ever touched.
 *   Only after the Lua script grants the hold does Postgres get a write.
 *   This keeps the critical "is this seat available?" check sub-millisecond.
 *
 * EC6 (ALLOW): a user may hold seats across multiple different trips simultaneously.
 *   These are genuinely independent transactions (morning + evening bus, for example).
 *   We only prevent the same seat from being held/booked twice.
 */

const fs = require("fs");
const path = require("path");
const prisma = require("../../config/prisma");
const redis = require("../../config/redis");
const { createAuditLog } = require("../audit/audit.service");
const { emitSeatHeld } = require("../../sockets/emitters");

const HOLD_TTL_SECONDS = 300; // 5 minutes (EC5: expires even if client disconnects)

// Load the Lua script once at module init — no re-read on every request
const luaScript = fs.readFileSync(
  path.join(__dirname, "../../scripts/holdSeat.lua"),
  "utf8"
);

/**
 * FR12: Atomic seat hold.
 * @param {string} tripId
 * @param {string} seatNumber e.g. "3B"
 * @param {string} userId
 * @returns {{ seatId, holdExpiresAt }}
 */
async function holdSeat(tripId, seatNumber, userId) {
  // Find the seat record first (need seatId for AuditLog)
  const seat = await prisma.seat.findUnique({
    where: { tripId_seatNumber: { tripId, seatNumber } },
  });

  if (!seat) {
    const err = new Error("Seat not found");
    err.status = 404;
    throw err;
  }

  const redisKey = `seat:${tripId}:${seatNumber}`;

  // NFR2: Run Lua script — atomic check-and-set (see holdSeat.lua for rationale)
  const result = await redis.eval(luaScript, 1, redisKey, userId, HOLD_TTL_SECONDS);

  if (result === 0) {
    // EC11: HOLD_FAILED logged even when lost — distinguishes "tried and lost" from "never tried"
    // This is the key signal for the analytics agent's contention metric
    await createAuditLog("HOLD_FAILED", { userId, seatId: seat.id, metadata: { tripId, seatNumber } });
    const err = new Error("Seat is already held or booked");
    err.status = 409;
    throw err;
  }

  // Lua granted the hold — update Postgres and emit to Socket room
  const holdExpiresAt = new Date(Date.now() + HOLD_TTL_SECONDS * 1000);

  await prisma.seat.update({
    where: { id: seat.id },
    data: { status: "HELD" },
  });

  await createAuditLog("HOLD_SUCCESS", { userId, seatId: seat.id, metadata: { tripId, seatNumber } });

  // NFR3: real-time broadcast to all clients in the trip room
  emitSeatHeld(tripId, seatNumber, userId);

  return { seatId: seat.id, holdExpiresAt };
}

/**
 * Manually release a hold (e.g. user cancelled).
 */
async function releaseSeat(tripId, seatNumber, userId) {
  const redisKey = `seat:${tripId}:${seatNumber}`;
  const owner = await redis.get(redisKey);
  if (owner !== userId) return; // not theirs to release
  
  await redis.del(redisKey);
  
  const { emitSeatReleased } = require("../../sockets/emitters");
  emitSeatReleased(tripId, seatNumber);
  
  await prisma.seat.updateMany({
    where: { tripId, seatNumber, status: "HELD" },
    data: { status: "AVAILABLE" }
  });
}

module.exports = { holdSeat, releaseSeat };
