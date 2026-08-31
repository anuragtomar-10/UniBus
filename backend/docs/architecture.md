# UniBus — Architecture Notes

A college bus seat-booking system with an admin-facing analytics agent.  
This document explains the **why** behind every non-obvious technical decision.

---

## 1. Database — PostgreSQL over MongoDB / MySQL

| Concern | Why PostgreSQL wins |
|---|---|
| ACID for seat booking | Seat hold + booking must be atomic. PostgreSQL's `SELECT … FOR UPDATE` row-locking is battle-tested for this. MongoDB has multi-document transactions but they're less mature and add latency. |
| Unique constraints as the final backstop | `@@unique([busId, date, departureTime])` prevents a bus from running two trips at the same time even if application code has a race. MySQL does support this, but Postgres's partial indexes and `DEFERRABLE` constraints are more expressive. |
| Analytics aggregations | All four analytics tools use grouping + ratio queries. Postgres's aggregate functions and window functions are significantly faster than MongoDB's `$group` pipeline for relational data. |

---

## 2. ORM — Prisma over raw SQL

- **Schema as the single source of truth**: `schema.prisma` defines models, relations, indexes, and enums in one file. Prisma generates a fully-typed client — no hand-written `INSERT INTO` strings to maintain.
- **Migration history**: `prisma migrate dev` creates timestamped SQL migration files. The team can replay them on any environment.
- **One deliberate exception**: `prisma.$transaction` with raw `SELECT … FOR UPDATE` in `confirm.service.js`. Prisma does not expose `SELECT … FOR UPDATE` through its high-level API, so we drop to raw SQL exactly there and nowhere else (NFR8).

---

## 3. Redis Lua atomicity for seat hold

The hold operation must be **atomic**: check if the key already exists AND set it in one step.  
If two users try to hold the same seat at the same millisecond, only one Redis command wins.

A plain `GET` + conditional `SET` in application code is NOT atomic — there is a window between the two calls where a race can happen. The Lua script runs atomically inside the Redis server, eliminating this window entirely (NFR7, EC5).

```lua
-- holdSeat.lua (abridged logic)
if redis.call("EXISTS", KEYS[1]) == 1 then return 0 end
redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
return 1
```

---

## 4. JWT split — short access token + long refresh token

| Token | TTL | Storage |
|---|---|---|
| Access JWT | 15 minutes | In-memory (React state / localStorage) |
| Refresh JWT | 7 days | PostgreSQL `RefreshToken` table |

**Why not a single long-lived token?**  
A compromised access token is valid for at most 15 minutes. The refresh token is stored server-side so it can be explicitly revoked (logout, `revoked: true`). This gives the security of server-side sessions with the scalability of stateless JWTs for the hot path.

**Rotation**: every `/auth/refresh` call issues a new access token. The refresh token itself is not rotated here (single-device assumption for a college app), but the `revoked` flag lets admins invalidate a specific device.

---

## 5. React Query vs Context API

| Concern | React Query | Context API |
|---|---|---|
| Server state (trips, seats, history) | ✅ Caching, background refetch, stale-while-revalidate | ❌ Manual fetch + useEffect spaghetti |
| Auth state (user object, token) | ❌ Not appropriate — not a server resource | ✅ Lightweight global state |

We use both: `AuthContext` for the logged-in user/token (pure client state), React Query for every API call. This avoids the common mistake of putting server data in Context and re-fetching it manually everywhere.

---

## 6. Vite over Create React App

CRA is deprecated (no longer maintained by the React team). Vite's dev server is 10–100× faster (native ES modules, no bundling in dev), and its production build uses Rollup which produces smaller chunks than CRA's webpack config.

---

## 7. Agent loop vs hardcoded analytics flow

Instead of writing four sequential analytics queries and hard-coding a rule engine (if utilization < 0.3 → remove from base), we give the model access to four tools and let it reason across them.

**Benefits:**
- The model can cross-reference tools in any order — e.g. check utilization first, then verify with special-trip frequency before recommending removal.
- New business rules (e.g. "check contention before ADD_TO_BASE") can be added to the system prompt without changing application code.
- The loop is bounded (6 iterations, NFR13) so it can't spin forever.

**Why not RAG?**  
RAG (retrieval-augmented generation) is for querying unstructured documents (PDFs, knowledge bases). Our data is fully structured in PostgreSQL. Direct Prisma queries are faster, more precise, and more auditable than embedding + vector search over booking records.

---

## 8. Provider-agnostic agent boundary

The Groq API uses an OpenAI-compatible tool-calling shape.  
Every Groq-specific detail is isolated in `callGroq()` inside `agent.js`:

```
callGroq() ← only function that references Groq SDK
   ↓
agent loop ← pure message-passing logic, no Groq import
   ↓
TOOL_MAP   ← pure Prisma functions, no LLM dependency
   ↓
persistRecommendations ← validation + DB write, no LLM dependency
```

Swapping Groq for any other OpenAI-compatible provider (OpenRouter, Together AI, local Ollama) requires changing exactly one function.

---

## 9. Passive seat reconciliation

When a client fetches the seat map (`GET /trips/:id/seats`), the service checks every `HELD` seat against Redis in parallel. If the Redis key is gone (TTL expired, Redis restart), the seat is immediately flipped back to `AVAILABLE` in Postgres and a `seat:released` socket event is emitted.

This means seat status is always eventually consistent within a single seat map load — no separate background job required (LLD §1).

---

## 10. Idempotency key for payment

Each confirm-booking attempt generates a fresh UUID v4 (`idempotencyKey`) in the frontend.  
The backend checks for an existing booking with that key before running the transaction.  
If the client retries (network timeout), the second request returns the first result, not a double charge (NFR4, EC7).

The `@@unique` constraint on `Booking.idempotencyKey` is the final backstop — even if two identical requests race, Postgres's unique violation (`P2002`) is caught and handled gracefully.

---

## 11. Edge cases summary

| EC | Mechanism |
|---|---|
| EC1 — duplicate weekly refresh | `refreshWeeklySchedule` skips dates that already have BASE trips |
| EC3 — bus/driver double-booking | `@@unique([busId,date,departureTime])` + `@@unique([driverId,date,departureTime])` |
| EC5 — hold TTL expiry | Passive reconciliation on seat map fetch |
| EC7 — double-confirm | `idempotencyKey` DB unique constraint + `P2002` catch |
| EC8 — hold race | Redis Lua atomicity; Postgres `SELECT … FOR UPDATE` in confirm |
| EC9 — cancel past trip | Checked against `trip.date + trip.departureTime` |
| EC10 — cancelled in history | History query uses `createdAt` filter, not status |
| EC11 — hold fail audit | `HOLD_FAILED` AuditLog written before throwing 409 |
| EC13 — remove from base | Agent instructed to check `getSpecialTripFrequency` first |
| EC14 — agent incomplete | Returns `{ error: "Analysis incomplete..." }` if iteration cap hit |
| EC15 — lookback cap | `Math.min(lookbackWeeks, 8)` in every analytics function |

## 12. Admin

How to log in as Admin: To enter the admin dashboard, you can log out of your current account and log back in using the default admin credentials that were created when the database was seeded:

Email: admin@unibus.local
Password: admin123

## 13. How to start this project

Terminal 1 — Databases (run once)
bash
# Open terminal in the root UniBus folder
docker compose up -d
Wait ~5 seconds for Postgres to be ready, then:

bash
cd backend
npm install
npx prisma migrate dev --name init
node prisma/seed.js

Terminal 2 — Backend
bash
# From the root folder:
cd backend
npm run dev

Terminal 3 — Frontend
bash
# From the root folder:
cd frontend
npm install
npm run dev