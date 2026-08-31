/**
 * Prisma singleton client.
 * Why Prisma over raw SQL / other ORMs:
 *   - Type-safe generated client eliminates a whole class of runtime type errors
 *   - Auto-migrations keep schema and DB in sync
 *   - Injection-safe query builder
 * Raw SQL is used in exactly one place: the pessimistic row-lock in confirm.service.js
 * (SELECT ... FOR UPDATE). Everything else goes through this typed client.
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
});

module.exports = prisma;
