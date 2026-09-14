/**
 * Auth middleware.
 *
 * verifyToken: validates the JWT access token from the Authorization header.
 * requireAdmin: guards admin-only routes, runs after verifyToken.
 *
 * Why access/refresh split over a single long-lived token (NFR5):
 *   If an access token leaks, it's only dangerous for 15 minutes.
 *   Refresh tokens live in the DB and are revocable server-side — if a
 *   refresh token is compromised, the admin can invalidate it by setting
 *   revoked=true without forcing a full logout of everyone.
 */

const jwt = require("jsonwebtoken");
const { jwtAccessSecret } = require("../config/env");

/**
 * Verifies the Bearer JWT access token.
 * On success, attaches the decoded payload as req.user.
 * On failure, returns 401.
 */
function verifyToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "No token provided" });
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, jwtAccessSecret); // returns the decoded payload inside the JWT if the token is valid ({id, email, role, iat, exp})
    req.user = decoded; // { id, email, role, iat, exp }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * Requires the authenticated user to have the ADMIN role.
 * Must be used after verifyToken.
 */
function requireAdmin(req, res, next) {
  if (req.user?.role !== "ADMIN") {
    return res.status(403).json({ error: "Admin access required" });
  }
  next();
}

module.exports = { verifyToken, requireAdmin };
