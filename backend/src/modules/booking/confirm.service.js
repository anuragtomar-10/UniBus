/**
 * Confirm booking service.
 *
 * This is the most critical path in UniBus. Every NFR converges here:
 *   NFR1: @@unique constraints prevent double-booking at DB level
 *   NFR4: idempotency key prevents double-charge on network retry (EC7)
 *   NFR7: entire booking confirmation is ACID transactional
 *   NFR8: one deliberate raw SQL query — SELECT ... FOR UPDATE (row-level pessimistic lock)
 *   EC8:  re-validates Redis hold ownership AND Postgres HELD status inside the locked tx
 *
 * Flow:
 *   1. Fast-path: if idempotencyKey already exists → return existing booking (no reprocessing)
 *   2. Start prisma.$transaction
 *   3. SELECT ... FOR UPDATE on the Seat row (raw SQL — the one exception to "no raw SQL")
 *   4. Re-validate: Redis key owner === userId AND Postgres status === HELD
 *   5. Mock payment
 *   6. Create Booking + Payment, flip Seat → BOOKED, write PAYMENT_SUCCESS audit log
 *   7. Catch P2002 on idempotencyKey (race between two identical retries) → return existing
 *   8. AFTER tx commits: delete Redis key, emit seat:booked, fire-and-forget email
 *      (email failure must never roll back a paid booking)
 */

const prisma = require("../../config/prisma");
const redis = require("../../config/redis");
const { createAuditLog } = require("../audit/audit.service");
const { processPayment } = require("./payment.service");
const { sendConfirmationEmail } = require("./email.service");
const { emitSeatBooked, emitSeatReleased } = require("../../sockets/emitters");

/**
 * FR13: Confirm a held seat booking.
 */
async function confirmBooking({ seatId, userId, idempotencyKey, cardLast4, amount = 150 }) {
  // ── Step 1: Idempotency fast-path (NFR4, EC7) ─────────────────────────────
  // If this idempotencyKey was already processed, return the existing booking.
  // Network drop after payment succeeds server-side → retry with same key → same result.
  const existing = await prisma.booking.findUnique({
    where: { idempotencyKey },
    include: { seat: { include: { trip: true } }, payment: true },
  });
  if (existing) return existing;

  // ── Step 2: Get seat for Redis key lookup ─────────────────────────────────
  const seat = await prisma.seat.findUnique({
    where: { id: seatId },
    include: { trip: true },
  });
  if (!seat) {
    const err = new Error("Seat not found");
    err.status = 404;
    throw err;
  }

  const redisKey = `seat:${seat.trip.id}:${seat.seatNumber}`;
  let booking;

  try {
    // ── Step 3–7: Transaction ────────────────────────────────────────────────
    booking = await prisma.$transaction(async (tx) => {
      // NFR8 / EC8: Pessimistic row lock — the one deliberate raw SQL exception.
      // Prevents two racing confirm requests from both seeing HELD and both proceeding.
      const [lockedSeat] = await tx.$queryRaw`
        SELECT * FROM "Seat" WHERE id = ${seatId} FOR UPDATE
      `;

      // EC8: Re-validate inside the locked transaction.
      // Never trust the frontend's belief that a hold is still valid.
      const redisOwner = await redis.get(redisKey);
      if (redisOwner !== userId || lockedSeat.status !== "HELD") {
        await createAuditLog("PAYMENT_FAILED", {
          userId,
          seatId,
          metadata: {
            reason: "Hold invalid or expired",
            redisOwner,
            dbStatus: lockedSeat.status,
          },
        });
        const err = new Error("Hold has expired or belongs to another user");
        err.status = 409;
        throw err;
      }

      const paymentResult = await processPayment({ bookingId: idempotencyKey, amount, cardLast4 });
      if (!paymentResult.success) {
        await createAuditLog("PAYMENT_FAILED", {
          userId,
          seatId,
          metadata: { reason: paymentResult.reason },
        });
        
        // EC5 / User Request: If payment is declined, instantly release the hold in DB
        await tx.seat.update({
          where: { id: seatId },
          data: { status: "AVAILABLE" },
        });

        // Return a special object to handle Redis/Socket cleanup outside the tx
        return { isPaymentFailure: true, reason: paymentResult.reason };
      }

      // ── Create Booking + Payment, flip Seat ────────────────────────────────
      const newBooking = await tx.booking.create({
        data: {
          userId,
          seatId,
          idempotencyKey,
          status: "CONFIRMED",
          payment: {
            create: {
              amount,
              status: "SUCCESS",
            },
          },
        },
        include: { seat: { include: { trip: true } }, payment: true },
      });

      await tx.seat.update({
        where: { id: seatId },
        data: { status: "BOOKED" },
      });

      await createAuditLog("PAYMENT_SUCCESS", {
        userId,
        seatId,
        bookingId: newBooking.id,
        metadata: { transactionId: paymentResult.transactionId, amount },
      });

      return newBooking;
    });
  } catch (err) {
    // NFR4: If two identical retries race and both pass idempotency fast-path,
    // one will hit a unique constraint on idempotencyKey — treat as success.
    if (err.code === "P2002" && err.meta?.target?.includes("idempotencyKey")) {
      return prisma.booking.findUnique({
        where: { idempotencyKey },
        include: { seat: { include: { trip: true } }, payment: true },
      });
    }
    throw err;
  }

  // ── Handle Payment Failure Cleanup ──────────────────────────────────────
  if (booking && booking.isPaymentFailure) {
    redis.del(redisKey).catch((e) => console.error("Redis del failed:", e.message));
    redis.del(`user_hold_trip:${seat.trip.id}:${userId}`).catch((e) => console.error("Redis user hold del failed:", e.message));
    emitSeatReleased(seat.trip.id, seat.seatNumber);
    const err = new Error(`Payment declined: ${booking.reason}`);
    err.status = 402;
    throw err;
  }

  // ── Step 8: Post-transaction cleanup (AFTER commit, never inside tx) ──────
  // Deleting Redis key and sending email are fire-and-forget — failures here
  // must not roll back a successfully paid booking.

  // Delete Redis hold key
  redis.del(redisKey).catch((e) => console.error("Redis del failed:", e.message));
  redis.del(`user_hold_trip:${booking.seat.trip.id}:${userId}`).catch((e) => console.error("Redis user hold del failed:", e.message));

  // Emit seat:booked to all clients in the trip room
  emitSeatBooked(booking.seat.trip.id, booking.seat.seatNumber);

  // Fire-and-forget confirmation email (FR15)
  sendConfirmationEmail({
    to: booking.seat.trip.id, // We'd use user email in production; use userId for now
    bookingId: booking.id,
    seatNumber: booking.seat.seatNumber,
    tripDate: booking.seat.trip.date,
    route: `${booking.seat.trip.origin} → ${booking.seat.trip.destination}`,
    departureTime: booking.seat.trip.departureTime,
  }).catch((e) => console.error("Email send failed:", e.message));

  return booking;
}

module.exports = { confirmBooking };
