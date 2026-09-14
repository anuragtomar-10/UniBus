/**
 * Auth service — all authentication business logic.
 *
 * bcrypt cost-12: deliberately slower than lower costs, making brute-force
 * attacks computationally expensive. Each hash takes ~250ms on modern hardware,
 * which is imperceptible to users but devastating for attackers trying millions
 * of passwords.
 *
 * JWT access/refresh split (NFR5):
 *   - Access token: 15 min TTL, stateless, fast to verify
 *   - Refresh token: 7 day TTL, persisted in RefreshToken table, revocable
 *   If an access token leaks, it's only dangerous for 15 minutes.
 *   Refresh tokens are revocable server-side by setting revoked=true.
 */

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const prisma = require("../../config/prisma");
const { jwtAccessSecret, jwtRefreshSecret } = require("../../config/env");

const BCRYPT_ROUNDS = 12; // NFR5
const ACCESS_TOKEN_TTL = "15m"; // NFR5
const REFRESH_TOKEN_TTL_DAYS = 7; // NFR5

/** Generate a signed access JWT (short-lived, stateless) */
function signAccessToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role },
    jwtAccessSecret,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

/** Generate a signed refresh JWT and persist it to the DB */
async function createRefreshToken(userId) {
  const token = uuidv4(); // opaque token stored in DB, not a signed JWT
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await prisma.refreshToken.create({
    data: { token, userId, expiresAt },
  });
  return token;
}

/**
 * Register a new user.
 * FR1: Registration for STUDENT and ADMIN roles only.
 * Passwords hashed with bcrypt.hash(password, 12).
 */
async function register({ name, email, password, role }) {
  // Validate role
  if (!["STUDENT", "ADMIN"].includes(role)) {
    const err = new Error("Role must be STUDENT or ADMIN");
    err.status = 400;
    throw err;
  }

  // Check for existing user
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const err = new Error("Email already registered");
    err.status = 409;
    throw err;
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await prisma.user.create({
    data: { name, email, passwordHash, role },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return user;
}

/**
 * Login with email + password.
 * FR2: bcrypt.compare, issues access token (15min) + refresh token (7d, persisted).
 */
async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    const err = new Error("Invalid credentials");
    err.status = 401;
    throw err;
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    const err = new Error("Invalid credentials");
    err.status = 401;
    throw err;
  }

  const accessToken = signAccessToken(user);
  const refreshToken = await createRefreshToken(user.id);

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    },
  };
}

/**
 * Get current user from access token (used by /auth/me).
 * FR3: returns the user for rehydrating AuthContext on frontend app load.
 */
async function getMe(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });
  if (!user) {
    const err = new Error("User not found");
    err.status = 404;
    throw err;
  }
  return user;
}

/**
 * Refresh access token using a valid, non-revoked refresh token.
 * Issues a new access token. Refresh token itself is not rotated here
 * (simpler — rotation would require deleting the old row and creating a new one).
 */
async function refreshAccessToken(token) {
  const record = await prisma.refreshToken.findUnique({
    where: { token },
    include: { user: true }, // 
  });

  if (!record || record.revoked || record.expiresAt < new Date()) {
    const err = new Error("Invalid or expired refresh token");
    err.status = 401;
    throw err;
  }

  const accessToken = signAccessToken(record.user);
  return { accessToken };
}

/**
 * Logout: revoke the refresh token so it cannot be used again (NFR5).
 * Self-revoke on logout by setting revoked=true on the row.
 */
async function logout(token) {
  await prisma.refreshToken.updateMany({
    where: { token },
    data: { revoked: true },
  });
}

module.exports = { register, login, getMe, refreshAccessToken, logout };
