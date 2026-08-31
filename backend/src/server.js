/**
 * HTTP server + Socket.io bootstrap.
 * Socket.io is attached here (not in app.js) so the same server handles both
 * HTTP requests and WebSocket connections — required for Socket.io to work.
 */

require("./config/env"); // Fail fast on missing env vars
const http = require("http");
const app = require("./app");
const { initSocket } = require("./sockets");
const { port } = require("./config/env");

// Ensure Redis connection is initialised at startup
require("./config/redis");

const server = http.createServer(app);

// Attach Socket.io to the HTTP server
initSocket(server);

server.listen(port, () => {
  console.log(`🚀 UniBus backend running on http://localhost:${port}`);
});
