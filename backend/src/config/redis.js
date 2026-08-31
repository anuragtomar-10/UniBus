/**
 * Redis (ioredis) singleton client.
 *
 * Why Redis + Lua over plain Redis GET/SET:
 *   A plain GET-then-SET is NOT atomic across two requests. Two simultaneous
 *   hold attempts on the same seat can both pass the "is this key set?" check
 *   before either finishes the write — classic TOCTOU race condition.
 *
 *   A Lua script runs as a single uninterruptible Redis operation, making
 *   check-and-set genuinely atomic. This is the foundation of NFR2.
 *
 * Why Redis before Postgres (NFR9):
 *   Redis is the hot path — seat hold attempts hit Redis before Postgres is
 *   ever touched. Only after the Lua script grants the hold does Postgres get
 *   a write. This keeps the happy path sub-millisecond at the critical step.
 */

const { redisUrl } = require("./env");
const Redis = require("ioredis");

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  lazyConnect: false,
});

redis.on("connect", () => console.log("✅ Redis connected"));
redis.on("error", (err) => console.error("❌ Redis error:", err.message));

module.exports = redis;
