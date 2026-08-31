/**
 * FR18: Booking history for the authenticated student.
 * Returns bookings from the last 30 days, filtered by createdAt (not status).
 * Includes cancelled bookings (EC10) — history reflects everything created
 * in that window regardless of current status.
 *
 * This is a display filter only — data is never deleted or archived.
 * Backed by the [userId, createdAt] composite index (NFR11).
 */

const prisma = require("../../config/prisma");

async function getBookingHistory(userId) {
  const since = new Date();
  since.setDate(since.getDate() - 30);

  return prisma.booking.findMany({
    where: {
      userId,
      createdAt: { gte: since }, // EC10: filter by createdAt, not status
    },
    include: {
      seat: {
        include: {
          trip: { include: { bus: true, driver: true } },
        },
      },
      payment: true,
    },
    orderBy: { createdAt: "desc" },
  });
}

module.exports = { getBookingHistory };
