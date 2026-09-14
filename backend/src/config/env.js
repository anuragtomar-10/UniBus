/**
 * Centralised environment variable validation.
 * Fail fast on startup if required vars are missing — better than a cryptic runtime error later.
 */

require("dotenv").config(); // loads variables from .env into process.env

const required = [
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

// GROQ_API_KEY is only required for the analytics agent — warn but don't crash
if (!process.env.GROQ_API_KEY) {
  console.warn(
    "⚠️  GROQ_API_KEY not set — POST /admin/analytics/insights will fail"
  );
}

module.exports = {
  databaseUrl: process.env.DATABASE_URL,
  redisUrl: process.env.REDIS_URL,
  jwtAccessSecret: process.env.JWT_ACCESS_SECRET,
  jwtRefreshSecret: process.env.JWT_REFRESH_SECRET,
  groqApiKey: process.env.GROQ_API_KEY,
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",
  port: parseInt(process.env.PORT || "3001", 10),
  nodeEnv: process.env.NODE_ENV || "development",
};
