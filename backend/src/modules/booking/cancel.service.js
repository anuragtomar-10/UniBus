/**
 * Cancel booking service.
 *
 * EC9: Cancellation rejected if the trip's departure has already passed.
 * FR14: Frees the seat, broadcasts seat:released.
 */

const prisma = require("../../config/prisma");
const redis = require("../../config/redis");
const { createAuditLog } = require("../audit/audit.service");
const { emitSeatReleased } = require("../../sockets/emitters");

async function cancelBooking(bookingId, userId) {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { seat: { include: { trip: true } } },
  });

  if (!booking) {
    const err = new Error("Booking not found");
    err.status = 404;
    throw err;
  }

  if (booking.userId !== userId) {
    const err = new Error("Not authorised to cancel this booking");
    err.status = 403;
    throw err;
  }

  if (booking.status === "CANCELLED") {
    const err = new Error("Booking is already cancelled");
    err.status = 409;
    throw err;
  }

  // EC9: Reject if trip departure has already passed
  const trip = booking.seat.trip;
  const [h, m] = trip.departureTime.split(":").map(Number);
  const tripDateTime = new Date(trip.date);
  tripDateTime.setHours(h, m, 0, 0);

  if (tripDateTime < new Date()) {
    const err = new Error("Cannot cancel a booking after the trip has departed");
    err.status = 400;
    throw err;
  }

  // Cancel booking + free seat in a transaction
  await prisma.$transaction([
    prisma.booking.update({
      where: { id: bookingId },
      data: { status: "CANCELLED", cancelledAt: new Date() },
    }),
    prisma.seat.update({
      where: { id: booking.seatId },
      data: { status: "AVAILABLE" },
    }),
  ]);

  // Clean up Redis hold key (if somehow still present — defensive)
  const redisKey = `seat:${trip.id}:${booking.seat.seatNumber}`;
  redis.del(redisKey).catch(() => {});

  await createAuditLog("CANCELLED", {
    userId,
    seatId: booking.seatId,
    bookingId,
    metadata: { tripId: trip.id, seatNumber: booking.seat.seatNumber },
  });

  // Notify all clients in the trip room
  emitSeatReleased(trip.id, booking.seat.seatNumber);

  return { message: "Booking cancelled successfully" };
}

module.exports = { cancelBooking };
