/**
 * Mock email service.
 *
 * Logs and persists to EmailLog — swappable for a real provider (SendGrid, SES, etc.)
 * without touching any calling code. The interface is stable; only the implementation
 * inside this function changes when a real provider is wired.
 *
 * A failed email must NEVER roll back a completed booking (called after tx commits).
 * This is enforced architecturally: sendConfirmationEmail is always called outside
 * of prisma.$transaction, with errors caught and logged but not re-thrown.
 */

const prisma = require("../../config/prisma");

async function sendConfirmationEmail({ to, bookingId, seatNumber, tripDate, route, departureTime }) {
  const subject = `UniBus Booking Confirmed — ${seatNumber}`;
  const body = `
Hi,

Your seat has been confirmed.

Booking ID: ${bookingId}
Seat: ${seatNumber}
Route: ${route}
Date: ${tripDate}
Departure: ${departureTime}

Thank you for using UniBus!
`.trim();

  // Mock: log to console (would be replaced by provider SDK call)
  console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${body}\n`);

  // Persist to EmailLog for audit trail
  try {
    await prisma.emailLog.create({
      data: { to, subject, body },
    });
  } catch (err) {
    console.error("[EMAIL] Failed to persist to EmailLog:", err.message);
  }
}

module.exports = { sendConfirmationEmail };
