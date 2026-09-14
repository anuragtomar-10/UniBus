/**
 * Express application setup.
 * Routes are mounted here; server startup (listen + Socket.io) lives in server.js
 * to keep app.js testable without binding a port.
 */

const express = require("express");
const cors = require("cors");
const { frontendUrl } = require("./config/env");

// Route modules
const authRoutes = require("./modules/auth/auth.routes");
const scheduleRoutes = require("./modules/schedule/schedule.routes");
const tripsRoutes = require("./modules/trips/trips.routes");
const bookingRoutes = require("./modules/booking/booking.routes");
const auditRoutes = require("./modules/audit/audit.routes");
const analyticsRoutes = require("./modules/analytics/analytics.routes");

const app = express(); // Express Application Instance : used to define REST routes, middlewares, etc.

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: frontendUrl,
    credentials: true,
  })
);
app.use(express.json()); // Built-in middleware to parse incoming JSON requests; converts JSON to JS object and puts it into req.body

const apiRouter = express.Router();
apiRouter.use("/auth", authRoutes);
apiRouter.use("/", scheduleRoutes); // /admin/schedule/*, /admin/trips/special
apiRouter.use("/trips", tripsRoutes);
apiRouter.use("/", bookingRoutes); // /booking/*, /bookings/history
apiRouter.use("/admin", auditRoutes);
apiRouter.use("/admin/analytics", analyticsRoutes);

app.use("/api", apiRouter);

// ─── Health check ─────────────────────────────────────────────────────────────
app.get("/", (_req, res) =>
  res.json({ message: "UniBus API server is running", healthCheck: "/health" })
);
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: err.message || "Internal server error" });
});

module.exports = app;
