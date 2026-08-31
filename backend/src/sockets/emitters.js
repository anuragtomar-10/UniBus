/**
 * Socket.io event emitters for seat state changes.
 * All events are scoped to the `trip:{tripId}` room — only clients
 * viewing that specific trip receive the update (NFR3, zero polling).
 */

const { getIo } = require("./index");

function emitSeatHeld(tripId, seatNumber, userId) {
  getIo().to(`trip:${tripId}`).emit("seat:held", { tripId, seatNumber, userId });
}

function emitSeatReleased(tripId, seatNumber) {
  getIo().to(`trip:${tripId}`).emit("seat:released", { tripId, seatNumber });
}

function emitSeatBooked(tripId, seatNumber) {
  getIo().to(`trip:${tripId}`).emit("seat:booked", { tripId, seatNumber });
}

module.exports = { emitSeatHeld, emitSeatReleased, emitSeatBooked };
