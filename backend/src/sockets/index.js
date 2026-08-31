/**
 * Socket.io server setup.
 *
 * NFR3: Real-time propagation of seat state to all connected clients, zero polling.
 * Clients join a room named `trip:{tripId}` when they open the seat map for a trip.
 * Events emitted to that room: seat:held, seat:released, seat:booked.
 *
 * Why rooms instead of broadcasting to all clients:
 *   Only clients currently viewing a specific trip need to know its seat updates.
 *   Rooms scope the event fan-out appropriately.
 */

const { Server } = require("socket.io");
const { frontendUrl } = require("../config/env");

let io;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: frontendUrl,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    // Client joins a trip room to receive seat state updates for that trip
    socket.on("join:trip", (tripId) => {
      socket.join(`trip:${tripId}`);
    });

    socket.on("leave:trip", (tripId) => {
      socket.leave(`trip:${tripId}`);
    });
  });

  console.log("✅ Socket.io initialised");
  return io;
}

function getIo() {
  if (!io) throw new Error("Socket.io not initialised — call initSocket first");
  return io;
}

module.exports = { initSocket, getIo };
