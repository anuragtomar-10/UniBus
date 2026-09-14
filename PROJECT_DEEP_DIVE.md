# PROJECT_DEEP_DIVE.md — UniBus

---

## 1. System Overview

UniBus is a real-time college bus seat-booking platform: students search fixed-route trips (College ↔ Raja Park, College ↔ Ajmeri Gate), reserve seats through an atomic Redis-Lua hold → Postgres-transactional confirm pipeline, and receive live seat-state updates via Socket.io — while admins manage a weekly schedule template, create ad-hoc special trips, and run an LLM-powered analytics agent that reads booking/contention/cancellation data to recommend schedule changes. The stack is **Express 4.21** (CommonJS) / **Prisma 5.22** / **PostgreSQL 16** / **Redis 7** (ioredis 5.4) / **Socket.io 4.8** / **jsonwebtoken 9** / **bcrypt 5** / **groq-sdk 0.7** (Groq cloud, model `qwen/qwen3.8-27b`) on the backend, and **React 19** / **React Router 7** / **TanStack React Query 5** / **Axios 1.20** / **socket.io-client 4.8** / **Vite 8** / **Tailwind CSS 4** / **TypeScript 6** on the frontend, with **Docker Compose** for Postgres 16-alpine + Redis 7-alpine. One-sentence pitch: *"A real-time seat-booking system where Redis Lua scripts give you sub-millisecond atomic holds, Postgres row-level locks give you ACID confirmations, Socket.io gives you a live seat map, and an LLM analytics agent gives admins data-driven schedule recommendations — all in one codebase."*

---

## 2. Requirement-to-Implementation Map

### FR1 — Registration (STUDENT / ADMIN)

**File:** `backend/src/modules/auth/auth.service.js` → `register()`  
**Route:** `POST /api/auth/register` — `backend/src/modules/auth/auth.routes.js:7`

```js
// auth.service.js:52-74
async function register({ name, email, password, role }) {
  if (!["STUDENT", "ADMIN"].includes(role)) {
    const err = new Error("Role must be STUDENT or ADMIN");
    err.status = 400;
    throw err;
  }
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
```

**Why:** Role is validated server-side — not trusted from the client. The `email` column has `@unique` in Prisma so even if the app-level check races, Postgres prevents duplicates. The controller (`auth.controller.js:3-14`) auto-logs in after registration by calling `authService.login()` immediately, returning an access token so the frontend can redirect without a second round-trip.

**Naive alternative (and why it fails):** Checking email uniqueness only in application code without `@unique` — two concurrent registrations with the same email would both pass the `findUnique` check before either `create` completes.

---

### FR2 — Login with JWT access/refresh rotation

**File:** `backend/src/modules/auth/auth.service.js` → `login()`, `signAccessToken()`, `createRefreshToken()`  
**Route:** `POST /api/auth/login`

```js
// auth.service.js:81-109
async function login({ email, password }) {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) { /* 401 */ }
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) { /* 401 */ }
  const accessToken = signAccessToken(user);       // 15-min JWT
  const refreshToken = await createRefreshToken(user.id); // 7-day, DB-persisted
  return { accessToken, refreshToken, user: { id, name, email, role } };
}
```

**Mechanism:** Access token is a signed JWT with `{ id, email, role }` payload, 15-min expiry. Refresh token is a UUID v4 stored in the `RefreshToken` table (`token` column is `@unique`). The `refreshAccessToken()` function (line 133) verifies the refresh token is not revoked and not expired, then issues a fresh access JWT without rotating the refresh token itself.

**Why split:** A leaked access token is dangerous for only 15 minutes. Refresh tokens are revocable server-side by setting `revoked=true`. The naive single-long-lived-token approach means a compromised token is valid for its entire lifetime with no server-side revocation possible (stateless JWT = no revocation without a blacklist).

**⚠️ DISCREPANCY:** The spec says "JWT access/refresh rotation" — the implementation does **not** rotate refresh tokens on each use. The refresh token stays the same until it expires or is revoked on logout. This is noted in code: *"Refresh token itself is not rotated here (simpler — rotation would require deleting the old row and creating a new one)."* This is a deliberate simplification for a single-device college app.

---

### FR3 — `/auth/me` session hydration

**File:** `backend/src/modules/auth/auth.service.js` → `getMe()`  
**Route:** `GET /api/auth/me` — requires `verifyToken` middleware  
**Frontend:** `frontend/src/context/AuthContext.jsx` → `useEffect` on mount

```js
// AuthContext.jsx:11-24
useEffect(() => {
  const token = localStorage.getItem("accessToken");
  if (!token) { setLoading(false); return; }
  api.get("/auth/me")
    .then((res) => setUser(res.data.user))
    .catch(() => { localStorage.removeItem("accessToken"); })
    .finally(() => setLoading(false));
}, []);
```

**Why:** On page refresh, the React state is gone. The access token persists in `localStorage`, so the frontend calls `/auth/me` to rehydrate the user object. If the token is expired, the 401 response triggers the axios interceptor (`api.js:18-27`) which clears localStorage and redirects to `/login`.

---

### FR4 — Driver as a pure DB record, no auth

**File:** `backend/prisma/schema.prisma` → `model Driver` (lines 76-83)

```prisma
model Driver {
  id        String             @id @default(uuid())
  name      String
  licenseNo String             @unique
  phone     String
  baseTrips BaseScheduleTrip[]
  trips     Trip[]
}
```

There is no `passwordHash`, no `email`, no `refreshTokens` relation — Driver has **zero authentication surface**. It exists purely as a FK reference from `Trip` and `BaseScheduleTrip` for operational tracking. The admin selects a driver from a dropdown when creating a base template trip or a special trip (`GET /api/admin/drivers`).

---

### FR5 — Base weekly schedule (editable template)

**File:** `backend/src/modules/schedule/schedule.service.js` → `listBaseTrips()`, `createBaseTrip()`, `updateBaseTrip()`, `deleteBaseTrip()`  
**Routes:** `GET/POST/PATCH/DELETE /api/admin/schedule/base` — all require `verifyToken` + `requireAdmin`

```js
// schedule.service.js:62-78
async function updateBaseTrip(id, data) {
  // EC2: base template edits never retroactively affect existing Trip rows.
  return prisma.baseScheduleTrip.update({
    where: { id }, data,
    include: { bus: true, driver: true },
  });
}

async function deleteBaseTrip(id) {
  // Soft delete — set isActive:false so historical reference is preserved
  return prisma.baseScheduleTrip.update({
    where: { id }, data: { isActive: false },
  });
}
```

**Why this design:** `BaseScheduleTrip` and `Trip` are **structurally separate Prisma models**. Editing a `BaseScheduleTrip` row cannot propagate to any `Trip` row — they are in different tables with no cascade-on-update. This separation is the schema-level guarantee that a template change never corrupts existing bookable trips.

---

### FR6 — Manual Sunday refresh job

**File:** `backend/src/modules/schedule/schedule.service.js` → `refreshWeeklySchedule()`  
**Route:** `POST /api/admin/schedule/refresh` — admin-only

```js
// schedule.service.js:135-203
async function refreshWeeklySchedule() {
  const thisWeek = getThisWeekDates();
  const nextWeek = getNextWeekDates();
  // Deduplicate...
  for (const { date, dayOfWeek } of weekDates) {
    const existingCount = await prisma.trip.count({
      where: { date, source: "BASE" },
    });
    if (existingCount > 0) {
      results.skipped.push(date.toISOString().split("T")[0]);
      continue; // EC1: idempotent skip
    }
    const baseTrips = await prisma.baseScheduleTrip.findMany({
      where: { dayOfWeek, isActive: true },
    });
    for (const baseTrip of baseTrips) {
      await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.create({
          data: { ...fields, source: "BASE", baseScheduleTripId: baseTrip.id }
        });
        await tx.seat.createMany({
          data: seatNumbers.map(sn => ({
            tripId: trip.id, seatNumber: sn, status: "AVAILABLE"
          }))
        });
      });
    }
  }
  return results;
}
```

**Mechanism:** For each date (Mon-Sat) in the current **and** next week, it checks if BASE trips already exist (idempotency — EC1). If not, it reads all active `BaseScheduleTrip` rows for that `dayOfWeek` and creates a `Trip` + 60 `Seat` rows inside a transaction. The function is additive only — it calls `prisma.trip.create`, never `update` or `delete` on `Trip`.

**Why manual, not cron:** Keeps the system simple and avoids hidden side-effects. The admin clicks the button; the frontend shows created/skipped counts. Not time-gated to Sunday so it works for testing/demos any day.

---

### FR7 — Current-week-only visibility

**File:** `backend/src/modules/trips/trips.service.js` → `searchTrips()` (lines 22-76)

```js
// trips.service.js:36-45
const dow = today.getDay();
const monday = new Date(today);
monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
const saturday = new Date(monday);
saturday.setDate(monday.getDate() + 5);

if (d < monday || d > saturday) {
  return []; // FR7: only current week
}
```

Students can only see trips in the current Mon-Sat range. Searching for a date outside this window returns an empty array — no error, just no results. Past trips within the current week are filtered out by comparing `tripDateTime > now` (line 69).

**EC4:** If the admin hasn't refreshed, the search simply returns `[]`. There is **no auto-fallback** to the base template.

---

### FR8 — Special/extra trips

**File:** `backend/src/modules/schedule/schedule.service.js` → `createSpecialTrip()`  
**Route:** `POST /api/admin/trips/special` — admin-only

```js
// schedule.service.js:215-268
async function createSpecialTrip({
  date, origin, destination, departureTime, busId, driverId,
}) {
  // EC3: App-level conflict check (DB @@unique is the backstop)
  const conflict = await prisma.trip.findFirst({
    where: { date: tripDate, departureTime, OR: [{ busId }, { driverId }] },
  });
  if (conflict) { throw 409 }

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: { ..., source: "SPECIAL", baseScheduleTripId: null },
    });
    await tx.seat.createMany({ ... }); // 60 seats
    return trip;
  });
}
```

**Key:** `source: "SPECIAL"` and `baseScheduleTripId: null`. EC3 (bus/driver conflict) is checked at app level and backstopped by `@@unique([busId, date, departureTime])` and `@@unique([driverId, date, departureTime])` on the `Trip` model.

---

### FR9 — Non-persistence of specials across refreshes

The `refreshWeeklySchedule()` function reads only from `BaseScheduleTrip` where `isActive: true`. Special trips have `source: "SPECIAL"` and exist only in the `Trip` table, not in `BaseScheduleTrip`. Therefore, the next refresh will never recreate them. This is structural, not conditional — the refresh function simply doesn't query the `Trip` table for what to create.

---

### FR10 — Search by date + time + destination

**File:** `backend/src/modules/trips/trips.service.js` → `searchTrips()`  
**Route:** `GET /api/trips/search?date=&time=&destination=`

```js
// trips.service.js:47-58
const where = { date: d };
if (destination) where.destination = destination;
if (time) where.departureTime = time;

const trips = await prisma.trip.findMany({
  where,
  include: { bus: true, driver: true,
             seats: { orderBy: { seatNumber: "asc" } } },
  orderBy: { departureTime: "asc" },
});
```

**Fixed route model:** The `Destination` enum has exactly three values: `COLLEGE`, `RAJA_PARK`, `AJMERI_GATE`. Routes are always `origin → destination` pairs. There is **no source filter** in the search — students see both BASE and SPECIAL trips. The `@@index([date, destination])` on `Trip` optimizes this query pattern.

**⚠️ DISCREPANCY from spec:** The spec says "fixed 4-route model (College/Raja Park/Ajmeri Gate)". The `Destination` enum has 3 destinations, but routes are origin/destination pairs — the seed creates College→Raja Park, College→Ajmeri Gate, and Raja Park→College. The "4th route" (Ajmeri Gate→College) is not seeded but is structurally supported by the enum.

---

### FR11 — Live seat map, Socket.io real-time propagation

**File (backend):** `backend/src/sockets/index.js` (setup), `backend/src/sockets/emitters.js` (events)  
**File (frontend):** `frontend/src/sockets/useSocket.js`, `frontend/src/features/booking/SeatMap.jsx`

```js
// emitters.js — all events scoped to trip rooms
function emitSeatHeld(tripId, seatNumber, userId) {
  getIo().to(`trip:${tripId}`).emit("seat:held",
    { tripId, seatNumber, userId });
}
function emitSeatReleased(tripId, seatNumber) {
  getIo().to(`trip:${tripId}`).emit("seat:released",
    { tripId, seatNumber });
}
function emitSeatBooked(tripId, seatNumber) {
  getIo().to(`trip:${tripId}`).emit("seat:booked",
    { tripId, seatNumber });
}
```

```js
// SeatMap.jsx:42-46 — on any socket event, invalidate React Query cache
const handleSeatEvent = useCallback(() => {
  queryClient.invalidateQueries({ queryKey: ["seats", tripId] });
}, [queryClient, tripId]);
useSocket(tripId, handleSeatEvent);
```

**Mechanism:** Client joins `trip:{tripId}` room when the seat map page loads. Every hold/release/book/cancel operation emits to that room. The frontend's `useSocket` hook listens for all three events and invalidates the React Query cache, triggering a re-fetch of the seat map. This means the seat grid is always current — zero polling.

**Why rooms, not broadcast:** Only clients viewing a specific trip care about its seat changes. Broadcasting to all connected clients would waste bandwidth.

---

### FR12 — Atomic seat hold via Redis + Lua script

**File:** `backend/src/scripts/holdSeat.lua`, `backend/src/modules/booking/hold.service.js` → `holdSeat()`

```lua
-- holdSeat.lua
local existingSeat = redis.call("GET", KEYS[1])
if existingSeat then return 0 end

local existingUserHold = redis.call("GET", KEYS[2])
if existingUserHold then return 0 end

redis.call("SET", KEYS[1], ARGV[1], "EX", ARGV[2])
redis.call("SET", KEYS[2], ARGV[1], "EX", ARGV[2])
return 1
```

```js
// hold.service.js:72-82
const result = await redis.eval(
  luaScript, 2, redisKey, userHoldKey, userId, HOLD_TTL_SECONDS
);
if (result === 0) {
  await createAuditLog("HOLD_FAILED", {
    userId, seatId: seat.id, metadata: { tripId, seatNumber }
  });
  throw 409;
}
```

**Two Redis keys per hold:**
1. `seat:{tripId}:{seatNumber}` → prevents the same seat being double-held
2. `user_hold_trip:{tripId}:{userId}` → prevents the same user from holding multiple seats on the same trip

Both keys have 300-second TTL. The Lua script checks **both** atomically — the entire check-and-set runs as a single uninterruptible Redis operation.

**Why not plain GET/SET:** A `GET` + conditional `SET` in Node.js has a TOCTOU window. Two requests can both see "key not set" before either writes. The Lua script eliminates this entirely — Redis executes the full script without interleaving other commands.

**After Lua grants:** `hold.service.js` updates Postgres `Seat.status → HELD`, writes a `HOLD_SUCCESS` audit log, and emits `seat:held` via Socket.io. If Lua returns 0, it writes `HOLD_FAILED` to the audit log (EC11) and throws 409.

---

### FR13 — Booking confirmation: Postgres transaction, row-level lock, idempotency key, mock payment

**File:** `backend/src/modules/booking/confirm.service.js` → `confirmBooking()`

**Step 1 — Idempotency fast-path:**
```js
// confirm.service.js:37-41
const existing = await prisma.booking.findUnique({
  where: { idempotencyKey },
  include: { seat: { include: { trip: true } }, payment: true },
});
if (existing) return existing; // no reprocessing
```

**Steps 3-7 — Transaction with row lock:**
```js
// confirm.service.js:59-132
booking = await prisma.$transaction(async (tx) => {
  // Raw SQL — the one deliberate exception to "no raw SQL"
  const [lockedSeat] = await tx.$queryRaw`
    SELECT * FROM "Seat" WHERE id = ${seatId} FOR UPDATE
  `;

  // EC8: re-validate Redis hold + Postgres status inside the lock
  const redisOwner = await redis.get(redisKey);
  if (redisOwner !== userId || lockedSeat.status !== "HELD") {
    await createAuditLog("PAYMENT_FAILED", { ... });
    throw 409;
  }

  const paymentResult = await processPayment({
    bookingId: idempotencyKey, amount, cardLast4
  });
  if (!paymentResult.success) {
    /* release seat, return special object */
  }

  const newBooking = await tx.booking.create({
    data: {
      userId, seatId, idempotencyKey, status: "CONFIRMED",
      payment: { create: { amount, status: "SUCCESS" } }
    },
  });
  await tx.seat.update({
    where: { id: seatId }, data: { status: "BOOKED" }
  });
  await createAuditLog("PAYMENT_SUCCESS", { ... });
  return newBooking;
});
```

**Step 8 — Post-transaction cleanup (fire-and-forget):**
```js
// confirm.service.js:160-174
redis.del(redisKey).catch(…);           // delete hold key
emitSeatBooked(tripId, seatNumber);     // Socket.io broadcast
sendConfirmationEmail({ … }).catch(…);  // FR15: mock email
```

**P2002 catch for idempotency races:**
```js
// confirm.service.js:136-141
if (err.code === "P2002" &&
    err.meta?.target?.includes("idempotencyKey")) {
  return prisma.booking.findUnique({
    where: { idempotencyKey }, ...
  });
}
```

**Why this structure:** The `SELECT … FOR UPDATE` acquires an exclusive row-level lock on the `Seat`. This prevents two racing confirm requests from both seeing `status=HELD` and both proceeding. The re-validation inside the lock (EC8) catches the window where Redis TTL expires between the user clicking "Pay" and the transaction running.

---

### FR14 — Cancellation, including departed-trip rejection

**File:** `backend/src/modules/booking/cancel.service.js` → `cancelBooking()`  
**Route:** `POST /api/booking/:id/cancel`

```js
// cancel.service.js:37-47 — EC9: departure check
const trip = booking.seat.trip;
const [h, m] = trip.departureTime.split(":").map(Number);
const tripDateTime = new Date(trip.date);
tripDateTime.setHours(h, m, 0, 0);

if (tripDateTime < new Date()) {
  const err = new Error(
    "Cannot cancel a booking after the trip has departed"
  );
  err.status = 400;
  throw err;
}
```

Cancellation is a batched Prisma transaction: `Booking.status → CANCELLED` + `Seat.status → AVAILABLE`. After the transaction, it defensively deletes any lingering Redis key, writes a `CANCELLED` audit log, and emits `seat:released`.

---

### FR15 — Mocked confirmation email

**File:** `backend/src/modules/booking/email.service.js` → `sendConfirmationEmail()`

```js
// email.service.js:15-41
async function sendConfirmationEmail({
  to, bookingId, seatNumber, tripDate, route, departureTime
}) {
  const subject = `UniBus Booking Confirmed — ${seatNumber}`;
  const body = `Hi,\n\nYour seat has been confirmed.\n...`;
  console.log(`[EMAIL] To: ${to}\nSubject: ${subject}\n${body}\n`);
  try {
    await prisma.emailLog.create({ data: { to, subject, body } });
  } catch (err) {
    console.error("[EMAIL] Failed to persist to EmailLog:",
                  err.message);
  }
}
```

**Why outside transaction:** The function is called in `confirm.service.js:167-174` **after** the `$transaction` block commits. It's wrapped in `.catch()` so a failed email never rolls back a paid booking. The `EmailLog` table provides an audit trail.

---

### FR16-FR20 — ⚠️ DISCREPANCY: Agentic Booking Assistant vs. Analytics Agent

> **CRITICAL DISCREPANCY:** The original spec calls for an "agentic booking assistant" with tools `searchTrips`, `holdSeat`, `respondToUser`, a first-available-seat + one-retry hold strategy, and an iteration cap. **What is actually implemented is an analytics agent** — an admin-facing tool that analyzes historical booking data and recommends schedule changes. There is **no user-facing conversational booking agent** in this codebase.

What **is** implemented (referenced as FR19-FR24 in the architecture doc):

**File:** `backend/src/modules/analytics/agent.js` → `runAnalyticsTurn()`

The analytics agent is a Groq tool-use loop with 5 tools:

| Tool | File | Purpose |
|---|---|---|
| `getUtilizationByRouteTime` | `analytics/tools/utilization.js` | Seat fill rate per route/time/day |
| `getContentionRate` | `analytics/tools/contention.js` | HOLD_FAILED / total hold attempts |
| `getCancellationPatterns` | `analytics/tools/cancellation.js` | Cancellation rate per slot |
| `getSpecialTripFrequency` | `analytics/tools/specialTrips.js` | Admin-created special trips per slot |
| `submitRecommendations` | `analytics/recommendation.service.js` | Persist validated recommendations |

```js
// agent.js:245-298 — the agentic loop
for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
  const response = await callGroq(messages, TOOL_DEFINITIONS);
  const assistantMsg = choice.message;
  messages.push(assistantMsg);
  const toolCalls = assistantMsg.tool_calls;
  if (!toolCalls || toolCalls.length === 0) break;

  for (const tc of toolCalls) {
    if (toolName === "submitRecommendations") {
      const result = await persistRecommendations(rawList);
      return result; // done
    }
    toolResult = await dispatchTool(toolName, toolArgs);
    messages.push({
      role: "tool", tool_call_id: tc.id,
      content: JSON.stringify(toolResult)
    });
  }
}
// EC14: cap hit without submitting
return { error: "Analysis incomplete..." };
```

**What makes this "agentic":** The LLM chooses which tools to call and in what order. It's not a fixed pipeline — the model can call utilization first, then contention, then decide it needs cancellation data. The loop is bounded at 6 iterations (NFR13).

**Why tool-calling, not RAG:** The data is fully structured in Postgres. Direct Prisma aggregations are faster, more precise, and more auditable than embedding booking records into vectors and doing similarity search.

---

### FR21-FR22 — Append-only AuditLog, admin query by booking ID

**File:** `backend/src/modules/audit/audit.service.js` → `createAuditLog()`  
**Route:** `GET /api/admin/audit/:bookingId` — admin-only

```js
// audit.service.js:25-33
async function createAuditLog(action,
    { userId, seatId, bookingId, metadata } = {}) {
  try {
    await prisma.auditLog.create({
      data: { action, userId, seatId, bookingId, metadata },
    });
  } catch (err) {
    // Audit log writes must never crash the main request flow
    console.error("AuditLog write failed:", err.message);
  }
}
```

**Append-only:** The service only exposes `create`. There is no `updateAuditLog` or `deleteAuditLog` function anywhere in the codebase. The `action` values are: `HOLD_SUCCESS`, `HOLD_FAILED`, `PAYMENT_SUCCESS`, `PAYMENT_FAILED`, `CANCELLED`.

**Admin query:** `audit.controller.js` queries by `bookingId` and returns all matching logs ordered by `createdAt`. The `@@index([bookingId])` on `AuditLog` ensures this is efficient.

---

### FR23 — 30-day booking history as a display-only filter

**File:** `backend/src/modules/booking/history.service.js` → `getBookingHistory()`  
**Route:** `GET /api/bookings/history`

```js
// history.service.js:13-31
async function getBookingHistory(userId) {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  return prisma.booking.findMany({
    where: {
      userId,
      createdAt: { gte: since } // filter by createdAt, not status
    },
    include: {
      seat: { include: {
        trip: { include: { bus: true, driver: true } }
      }},
      payment: true,
    },
    orderBy: { createdAt: "desc" },
  });
}
```

**Key:** Filters by `createdAt`, not `status`. Cancelled bookings within the 30-day window are included (EC10). The `@@index([userId, createdAt])` on `Booking` backs this query.

---

## 3. Non-Functional Requirements — How Each Is Actually Enforced

| NFR | Enforcement mechanism |
|---|---|
| **NFR1** — No double-booking of bus/driver at same date+time | `@@unique([busId, date, departureTime])` and `@@unique([driverId, date, departureTime])` on `Trip` model — schema.prisma:137-138. App-level check in `createSpecialTrip()` is the first line of defense; the DB constraint is the backstop. |
| **NFR2** — Atomic seat hold | Redis Lua script `holdSeat.lua` runs as a single uninterruptible Redis operation. Both `KEYS[1]` (seat key) and `KEYS[2]` (user-per-trip key) are checked and set atomically. |
| **NFR3** — Real-time seat state propagation, zero polling | Socket.io room `trip:{tripId}` — events `seat:held`, `seat:released`, `seat:booked` emitted from `emitters.js`. Frontend's `useSocket` hook invalidates React Query cache on any event. |
| **NFR4** — Idempotency for payment | `Booking.idempotencyKey` is `@unique`. `confirm.service.js:37-41` returns existing booking on duplicate key. `P2002` error code (unique violation) is caught at line 136 for the race case where two identical retries both pass the fast-path. |
| **NFR5** — Access/refresh token split | `auth.service.js`: Access JWT 15-min TTL, Refresh token 7-day TTL in `RefreshToken` table. Revocable via `revoked: true`. `middleware/auth.js:22-35` verifies access token on every protected route. |
| **NFR6** — Append-only audit log | `audit.service.js` exposes only `createAuditLog()`. No update/delete functions exist. The `AuditLog` model has no `updatedAt` field. |
| **NFR7** — ACID transactional booking | `confirm.service.js:59-132` — entire flow (row lock, re-validate, payment, create booking, flip seat) runs inside `prisma.$transaction()`. |
| **NFR8** — Single raw SQL exception | `confirm.service.js:62-64` — ``SELECT * FROM "Seat" WHERE id = ${seatId} FOR UPDATE``. This is the only `$queryRaw` in the entire codebase. Everything else uses the Prisma typed client. |
| **NFR9** — Redis as hot path before Postgres | `hold.service.js` calls `redis.eval(luaScript, ...)` (line 73) **before** writing to Postgres (line 87). The critical "is this seat available?" decision is made in Redis, not Postgres. |
| **NFR10** — Structural separation of BaseScheduleTrip and Trip | Two separate Prisma models. `refreshWeeklySchedule()` only calls `prisma.trip.create` — never `update` or `delete` on Trip. Editing `BaseScheduleTrip` cannot cascade to `Trip`. |
| **NFR11** — Composite index for 30-day history | `@@index([userId, createdAt])` on `Booking` — schema.prisma:172. Covers the exact query in `history.service.js`. |
| **NFR13** — Agent iteration cap | `agent.js:30` — `const MAX_ITERATIONS = 6`. The loop at line 245 breaks after 6 iterations. If `submitRecommendations` was never called, returns an error (EC14). |
| **NFR14** — Agent recommendation validation | `recommendation.service.js:29-51` — validates `evidence` is non-empty string, `suggestedAction` is one of 5 allowed enum values, `tripType` is BASE or SPECIAL. Invalid recommendations are silently dropped. |
| **NFR15** — Lookback week cap | `Math.min(lookbackWeeks, 8)` in every analytics tool function AND in `agent.js:235`. |

> **NFR12 is not referenced in the code.** If the original spec had an NFR12, it does not have a visible enforcement mechanism in this codebase.

---

## 4. Database Schema Deep Dive

### Full annotated `schema.prisma`

```prisma
enum Role { STUDENT  ADMIN }
// Only two roles — no DRIVER role. Driver is a reference entity, not a user.

enum Destination { COLLEGE  RAJA_PARK  AJMERI_GATE }
// Fixed 3-destination model. Routes are origin/destination pairs.

enum SeatStatus { AVAILABLE  HELD  BOOKED }
// Three-state lifecycle:
//   AVAILABLE → HELD (Redis TTL) → BOOKED (confirmed)
// HELD seats can revert to AVAILABLE via passive reconciliation
// or cancellation.

enum BookingStatus { CONFIRMED  CANCELLED }
// No PENDING status — a booking is created only when payment succeeds.

enum TripSource { BASE  SPECIAL }
// BASE = generated from weekly template.
// SPECIAL = admin ad-hoc creation.
// Read in: searchTrips (both shown), refreshWeeklySchedule (only
//   creates BASE), getSpecialTripFrequency analytics tool
//   (filters source="SPECIAL")

model User {
  id            String         @id @default(uuid())
  name          String
  email         String         @unique
  // @unique on email: prevents duplicate registration at DB level.
  // Race condition prevented: two concurrent register() calls both
  // pass findUnique → one succeeds at create, the other hits P2002.
  passwordHash  String
  role          Role           @default(STUDENT)
  createdAt     DateTime       @default(now())
  refreshTokens RefreshToken[]
  bookings      Booking[]
  @@index([email])
  // Index redundant with @unique (Postgres creates an index for
  // unique constraints), but explicitly declared for
  // documentation/intentionality.
}

model RefreshToken {
  id        String   @id @default(uuid())
  token     String   @unique
  // @unique on token: each refresh token is globally unique (UUID v4).
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  revoked   Boolean  @default(false)
  expiresAt DateTime
  createdAt DateTime @default(now())
  @@index([userId])
  // Index: lookup all tokens for a user (admin revocation).
}

model Driver {
  id        String             @id @default(uuid())
  name      String
  licenseNo String             @unique
  // @unique: no two drivers share a license number (real-world invariant).
  phone     String
  baseTrips BaseScheduleTrip[]
  trips     Trip[]
}

model Bus {
  id             String             @id @default(uuid())
  registrationNo String             @unique
  // @unique: each bus has a unique registration plate.
  totalSeats     Int                @default(60)
  // Stored per bus (not hardcoded in seat gen) so future bus types
  // with different capacities can be added without schema changes.
  baseTrips      BaseScheduleTrip[]
  trips          Trip[]
}

model BaseScheduleTrip {
  id            String      @id @default(uuid())
  dayOfWeek     Int // 1=Mon ... 6=Sat (Sunday excluded)
  origin        Destination
  destination   Destination
  departureTime String      // "HH:mm"
  busId         String
  bus           Bus         @relation(fields: [busId], references: [id])
  driverId      String
  driver        Driver      @relation(fields: [driverId], references: [id])
  isActive      Boolean     @default(true)
  // Soft delete preserves historical reference for already-generated
  // Trip rows that point back via baseScheduleTripId.

  @@unique([dayOfWeek, busId])
  // Prevents same bus assigned to two templates on the same day.
  @@unique([dayOfWeek, driverId])
  // Prevents same driver assigned to two templates on the same day.
}

model Trip {
  id                 String      @id @default(uuid())
  date               DateTime
  origin             Destination
  destination        Destination
  departureTime      String      // "HH:mm"
  busId              String
  bus                Bus         @relation(fields: [busId], references: [id])
  driverId           String
  driver             Driver      @relation(fields: [driverId], references: [id])
  source             TripSource
  // Written in: refreshWeeklySchedule (source="BASE"),
  //   createSpecialTrip (source="SPECIAL")
  // Read in: getSpecialTripFrequency analytics tool,
  //   refresh idempotency check
  baseScheduleTripId String?     // null for SPECIAL trips
  createdAt          DateTime    @default(now())
  seats              Seat[]

  @@unique([busId, date, departureTime])
  // Prevents: same bus running two trips at the exact same date+time.
  // Race condition prevented: two concurrent createSpecialTrip() calls
  // with the same bus and time — one succeeds, other hits P2002.
  @@unique([driverId, date, departureTime])
  // Prevents: same driver assigned to two trips at same date+time.
  @@index([date, destination])
  // Optimizes: searchTrips() WHERE clause.
}

model Seat {
  id         String     @id @default(uuid())
  tripId     String
  trip       Trip       @relation(fields: [tripId], references: [id])
  seatNumber String     // "1A".."10F"
  status     SeatStatus @default(AVAILABLE)
  booking    Booking?

  @@unique([tripId, seatNumber])
  // Prevents: duplicate seat numbers within a trip.
  // Used by: holdSeat() via findUnique({ where: { tripId_seatNumber } })
}

model Booking {
  id             String        @id @default(uuid())
  userId         String
  user           User          @relation(fields: [userId], references: [id])
  seatId         String        @unique
  // @unique on seatId: one booking per seat EVER (at DB level).
  seat           Seat          @relation(fields: [seatId], references: [id])
  status         BookingStatus @default(CONFIRMED)
  idempotencyKey String        @unique
  // @unique: prevents double-charge on network retry (NFR4, EC7).
  createdAt      DateTime      @default(now())
  cancelledAt    DateTime?
  payment        Payment?
  @@index([userId, createdAt])
  // Covers: getBookingHistory() query.
}

model Payment {
  id        String   @id @default(uuid())
  bookingId String   @unique
  // @unique: one payment per booking (1:1 relationship).
  booking   Booking  @relation(fields: [bookingId], references: [id])
  amount    Decimal
  status    String
  createdAt DateTime @default(now())
}

model AuditLog {
  id        String   @id @default(uuid())
  action    String
  userId    String?
  seatId    String?
  bookingId String?
  metadata  Json?
  createdAt DateTime @default(now())
  @@index([bookingId])
  // Covers: admin audit query GET /admin/audit/:bookingId
}

model EmailLog {
  id      String   @id @default(uuid())
  to      String
  subject String
  body    String
  sentAt  DateTime @default(now())
}

model Recommendation {
  id              String      @id @default(uuid())
  origin          Destination
  destination     Destination
  dayOfWeek       Int?
  departureTime   String?
  evidence        Json    // mandatory — validated server-side (NFR14)
  suggestedAction String
  tripType        String      @default("BASE")
  status          String      @default("PENDING")
  createdAt       DateTime    @default(now())
  reviewedAt      DateTime?
  @@index([status, createdAt])
  // Covers: admin listing filtered by status, ordered by recency.
}
```

### BaseScheduleTrip vs Trip separation

`BaseScheduleTrip` is the admin's **editable template** — it says "every Monday, Bus 1 runs College→Raja Park at 08:00." `Trip` is the **actual bookable instance** — "on 2026-09-01 (Monday), Trip X runs College→Raja Park at 08:00."

The separation is the schema-level guarantee that:
1. Editing a `BaseScheduleTrip` row changes future refreshes only, never existing `Trip` rows (EC2).
2. A refresh operation is structurally incapable of corrupting the template — it reads from `BaseScheduleTrip` and writes to `Trip`. There is no code path that writes back to `BaseScheduleTrip` during refresh.
3. Deleting a base template (soft-delete via `isActive: false`) doesn't cascade-delete existing trips.

### TripSource and InitiatedBy enums

**`TripSource`** (`BASE` | `SPECIAL`):
- **Written:** `refreshWeeklySchedule()` → `source: "BASE"`, `createSpecialTrip()` → `source: "SPECIAL"`
- **Read:** `refreshWeeklySchedule()` uses `source: "BASE"` in the idempotency count, `getSpecialTripFrequency()` analytics tool filters `source: "SPECIAL"`

**⚠️ DISCREPANCY:** The spec mentions an `InitiatedBy` enum (`USER` | `AGENT`). This enum **does not exist** in the codebase. There is no booking-level tracking of whether a booking was initiated by a user or an agent, because the agent booking assistant (FR16-FR20) was not implemented.

---

## 5. The Two Hardest Concurrency Problems, End to End

### 5a) Two users click the same seat within milliseconds

**Sequence:**

1. **User A** calls `POST /booking/hold` with `{ tripId, seatNumber: "3B" }` → `booking.controller.js:6` → `hold.service.js:36` `holdSeat(tripId, "3B", userA_id)`

2. **User B** calls `POST /booking/hold` with the same `{ tripId, seatNumber: "3B" }` 2ms later → same path.

3. **Both** pass the Prisma `seat.findUnique()` check (line 53) — at this point, Postgres shows `status: AVAILABLE` for both because neither has written yet.

4. **Both** reach `redis.eval(luaScript, ...)` (line 73).

5. **In Redis (atomic):** The Lua script for User A runs first:
   - `GET seat:{tripId}:3B` → nil → proceed
   - `GET user_hold_trip:{tripId}:{userA}` → nil → proceed
   - `SET seat:{tripId}:3B userA EX 300` → success
   - `SET user_hold_trip:{tripId}:{userA} userA EX 300` → success
   - Returns `1` (hold granted)

6. **In Redis (atomic):** The Lua script for User B runs next:
   - `GET seat:{tripId}:3B` → `userA` → **return 0** (hold denied)
   - The script exits immediately — User B never writes anything.

7. **User A path continues:**
   - `hold.service.js:87` → `prisma.seat.update({ status: "HELD" })`
   - `hold.service.js:92` → `createAuditLog("HOLD_SUCCESS", { userId: userA, seatId, ... })`
   - `hold.service.js:95` → `emitSeatHeld(tripId, "3B", userA)` → Socket.io broadcasts to all clients in `trip:{tripId}`

8. **User B path:**
   - `hold.service.js:78` → `createAuditLog("HOLD_FAILED", { userId: userB, seatId, ... })` — this `HOLD_FAILED` entry is the key signal for the analytics agent's contention metric (EC11)
   - Throws 409: `"Seat is already held or booked"`

9. **All clients viewing the seat map** receive `seat:held` via Socket.io → React Query cache invalidated → seat map re-fetches → seat "3B" now shows as HELD.

---

### 5b) Redis hold TTL expires at the exact moment user clicks "Confirm & Pay"

**Scenario:** User A held seat "3B" at T=0. At T=300s, the Redis key `seat:{tripId}:3B` expires. At T=300.001s, User A clicks "Pay" and the confirm request arrives.

**Sequence:**

1. **`confirm.service.js:37-41`** — Idempotency fast-path: no existing booking with this key → continue.

2. **`confirm.service.js:44-52`** — Fetch seat from Postgres: `Seat.status` is still `"HELD"` (Postgres hasn't been updated yet — no one has triggered passive reconciliation for this seat).

3. **`confirm.service.js:59-64`** — Transaction starts, acquires row lock:
   ```sql
   SELECT * FROM "Seat" WHERE id = $1 FOR UPDATE
   ```
   `lockedSeat.status` is `"HELD"` (Postgres is still stale).

4. **`confirm.service.js:68-69`** — Re-validation inside the lock:
   ```js
   const redisOwner = await redis.get(redisKey);  // → null (expired!)
   if (redisOwner !== userId || lockedSeat.status !== "HELD") {
     ...
   }
   ```
   `redisOwner` is `null`, which is `!== userId` → **condition triggers**.

5. **`confirm.service.js:70-78`** — Writes `PAYMENT_FAILED` audit log with metadata `{ reason: "Hold invalid or expired", redisOwner: null, dbStatus: "HELD" }`.

6. **`confirm.service.js:79-81`** — Throws 409: `"Hold has expired or belongs to another user"`.

7. **Transaction aborts** — no booking created, no payment charged, seat stays `"HELD"` in Postgres (until passive reconciliation).

8. **Passive reconciliation** (`trips.service.js:98-121`): The next time *anyone* fetches this trip's seat map, the service checks all `HELD` seats against Redis. For seat "3B", `redis.get()` returns null → Postgres is flipped back to `AVAILABLE` → `seat:released` emitted → the seat is bookable again.

**Why this structure catches the timing window:** The re-validation at step 4 happens **inside** the row-locked transaction, after `FOR UPDATE` has guaranteed no concurrent writes. It checks **both** Redis ownership (has the hold expired?) and Postgres status (has someone else already booked it?). This double-check inside the lock is the specific mechanism for EC8.

---

## 6. The Agent, Explained for a Skeptical Interviewer

### ⚠️ Important context: This is an analytics agent, not a booking assistant

The codebase implements an **analytics agent** (admin-facing, recommends schedule changes) — not the user-facing booking assistant described in FR16-FR20 of the original spec. The explanations below cover what's actually implemented.

### What makes this "agentic" versus a single LLM call

A single LLM call would be: "Here's all the data, give me recommendations." That requires dumping all analytics data into the prompt (expensive, limited by context window) and gives the model no ability to ask follow-up questions or drill into specific data.

The agentic approach in `agent.js` is a **tool-use loop**: the model receives tool definitions, decides which tools to call and in what order, receives their results, and iterates until it has enough data to submit recommendations. The key loop is at `agent.js:245-298`:

```js
for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
  const response = await callGroq(messages, TOOL_DEFINITIONS);
  // ...process tool calls, push results back into messages...
  for (const tc of toolCalls) {
    if (toolName === "submitRecommendations") {
      return result;
    }
    toolResult = await dispatchTool(toolName, toolArgs);
    messages.push({
      role: "tool", tool_call_id: tc.id,
      content: JSON.stringify(toolResult)
    });
  }
}
```

The model might call `getUtilizationByRouteTime` first, see a low-utilization slot, then decide to check `getSpecialTripFrequency` for that slot before recommending removal (EC13). This adaptive sequencing is what makes it agentic.

### Why tool-calling, not RAG

RAG is designed for retrieving relevant chunks from **unstructured, static knowledge** (documents, FAQs, manuals). Our analytics data is:
- **Structured** (Prisma models, SQL-queryable)
- **Live** (changes with every booking)
- **Transactional** (exact counts matter, not fuzzy similarity)

Vector embeddings of booking records would lose precision. A direct Prisma aggregate (`GROUP BY origin, destination, departureTime` → exact utilization ratio) is faster, more precise, and auditable. The LLM's job is synthesis and prioritization, not data retrieval.

### Exact tool definitions

Five tools defined in `agent.js:36-157`:

1. **`getUtilizationByRouteTime({ lookbackWeeks })`** — returns `bookedSeats / totalSeats` grouped by `(origin, destination, departureTime, dayOfWeek)`. Implementation: `analytics/tools/utilization.js`.
2. **`getContentionRate({ lookbackWeeks })`** — returns `HOLD_FAILED / (HOLD_SUCCESS + HOLD_FAILED)` from AuditLog. Implementation: `analytics/tools/contention.js`.
3. **`getCancellationPatterns({ lookbackWeeks })`** — returns `CANCELLED / total` from Booking. Implementation: `analytics/tools/cancellation.js`.
4. **`getSpecialTripFrequency({ lookbackWeeks })`** — counts Trip rows with `source=SPECIAL`. Implementation: `analytics/tools/specialTrips.js`.
5. **`submitRecommendations({ recommendations[] })`** — validates and persists up to 5 recommendations. Implementation: `analytics/recommendation.service.js`.

### Worked example

**Trigger:** Admin clicks "Run Insights" with `lookbackWeeks=4`.

1. `agent.js:233` → `runAnalyticsTurn(4)` → clamps to `Math.min(4, 8) = 4`
2. System prompt built (`agent.js:161-184`) — instructs the model on all 6 rules
3. **Iteration 1:** Model calls `getUtilizationByRouteTime({ lookbackWeeks: 4 })` and `getContentionRate({ lookbackWeeks: 4 })`
   - Both are dispatched via `dispatchTool()` (line 218-223)
   - Results pushed into `messages` as `role: "tool"` entries with `tool_call_id`
4. **Iteration 2:** Model sees high contention on `COLLEGE→RAJA_PARK 08:00 Monday`. Before recommending ADD_TO_BASE, it calls `getSpecialTripFrequency({ lookbackWeeks: 4 })` to check if specials already cover that slot.
5. **Iteration 3:** Model calls `submitRecommendations([{ origin: "COLLEGE", destination: "RAJA_PARK", departureTime: "08:00", dayOfWeek: 1, suggestedAction: "INCREASE_FREQUENCY", evidence: "utilization 0.95, contention 0.28 over 4 weeks — 28% of hold attempts failed" }])`
6. `recommendation.service.js:59` → `persistRecommendations()` validates each rec → creates Prisma rows → returns `{ saved: 1, skipped: 0, recommendations: [...] }`

### Where the payment boundary is enforced (analytics agent)

The analytics agent has **no tool that writes booking or payment data**. Its 4 read tools are pure `findMany` aggregations; `submitRecommendations` writes only to the `Recommendation` table. Even if the model hallucinated a tool call to `processPayment` or `confirmBooking`, the `dispatchTool()` function would throw `"Unknown tool"` because those names are not in `TOOL_MAP` (`agent.js:211-216`).

### Iteration cap and fail-safe

`MAX_ITERATIONS = 6` (`agent.js:30`). If the loop exhausts all 6 iterations without `submitRecommendations` being called, lines 300-306 return:
```js
{
  error: "Analysis incomplete: agent did not submit " +
    "recommendations within the iteration limit.",
  recommendations: [], saved: 0, skipped: 0
}
```

---

## 7. Edge Cases — Proof They're Actually Handled

### EC1 — Duplicate weekly refresh
**HANDLED.** `schedule.service.js:152-162` — counts existing BASE trips for each date; skips if `existingCount > 0`.

### EC2 — Base template edit affecting existing trips
**HANDLED.** Structural separation: `BaseScheduleTrip` and `Trip` are different Prisma models/DB tables. `updateBaseTrip()` calls `prisma.baseScheduleTrip.update()` — no foreign key cascade to `Trip`.

### EC3 — Bus/driver double-booking at same date+time
**HANDLED.** App-level: `createSpecialTrip()` line 228-242 checks for conflict. DB-level: `@@unique([busId, date, departureTime])` and `@@unique([driverId, date, departureTime])` on `Trip`.

### EC4 — Search before admin refresh
**HANDLED.** `searchTrips()` queries the `Trip` table. If no trips exist for that date, it returns `[]`. No auto-fallback to base template.

### EC5 — Hold TTL expiry
**HANDLED.** Redis key expires after 300s. Passive reconciliation in `getSeatMap()` (`trips.service.js:98-121`) checks all HELD seats against Redis on every read — if key is gone, flips Postgres to AVAILABLE and emits `seat:released`.

### EC6 — User holding seats across multiple trips
**HANDLED (ALLOWED).** The Lua script's per-trip key (`user_hold_trip:{tripId}:{userId}`) prevents multiple holds **within the same trip**, but different trips have different keys. The `hold.service.js` also pre-checks for existing bookings on the same trip (line 38-50).

### EC7 — Double-confirm on network retry
**HANDLED.** `confirm.service.js:37-41` returns existing booking on duplicate idempotency key. `P2002` catch at line 136 handles the race where two identical retries both pass the fast-path.

### EC8 — Hold race during confirm
**HANDLED.** `confirm.service.js:62-82` — `SELECT ... FOR UPDATE` row lock + re-validation of both Redis ownership and Postgres status inside the locked transaction.

### EC9 — Cancel after departure
**HANDLED.** `cancel.service.js:37-47` — compares `trip.date + trip.departureTime` against `new Date()`.

### EC10 — Cancelled bookings in history
**HANDLED.** `history.service.js:20` — filters by `createdAt >= 30 days ago`, not by status. Both CONFIRMED and CANCELLED bookings appear.

### EC11 — Hold failure audit logging
**HANDLED.** `hold.service.js:78` — `createAuditLog("HOLD_FAILED", ...)` is written before throwing 409. This distinguishes "tried and lost" from "never tried."

### EC12 — Agent cross-referencing multiple data sources
**HANDLED (prompt-enforced).** System prompt rule 1: "Call at least 2 read tools before submitting." Not enforced in code — relies on model compliance.

### EC13 — REMOVE_FROM_BASE guard against high special-trip frequency
**HANDLED (prompt-enforced).** System prompt rule 2: "Before recommending REMOVE_FROM_BASE, you MUST call getSpecialTripFrequency." Not enforced in code — relies on model compliance.

### EC14 — Agent iteration cap
**HANDLED.** `agent.js:300-306` — returns error object if loop exhausts `MAX_ITERATIONS` without `submitRecommendations`.

### EC15 — Lookback weeks cap
**HANDLED.** `agent.js:235` — `Math.min(lookbackWeeksInput, 8)`. Additionally, each analytics tool function independently caps at 8 weeks.

---

## 8. Things I Should Be Ready to Defend

**Q1: Why PostgreSQL over MongoDB for a booking system?**  
Booking requires ACID transactions. The confirm-booking flow uses `SELECT … FOR UPDATE` (pessimistic row locking) — MongoDB's multi-document transactions exist but are less mature, add latency, and don't support row-level locking at the same granularity. The `@@unique` constraints on Trip and Booking are the final backstop against double-booking — Postgres enforces these atomically.

**Q2: Why a Redis Lua script instead of Postgres advisory locks or a simple Redis SETNX?**  
SETNX only handles one key. Our hold requires checking two conditions atomically (seat not held AND user doesn't already hold another seat on this trip). A Lua script runs both checks and both writes as a single uninterruptible Redis operation. Postgres advisory locks would work but add ~10ms latency per hold attempt (Postgres round-trip) vs. sub-millisecond in Redis.

**Q3: Why passive reconciliation for expired holds instead of Redis keyspace notifications?**  
Keyspace notifications require a long-lived subscriber process that must stay connected to Redis. If it crashes, you miss events and seats stay HELD forever. Passive reconciliation (check on every seat map read) is simpler, self-healing, and the staleness window is bounded — at worst, a seat appears HELD for one extra read cycle (typically seconds).

**Q4: Why is the idempotency key generated on the frontend, not the backend?**  
The frontend generates a fresh UUID per payment attempt. If the network drops after the backend processes the payment but before the response arrives, the frontend retries with the same key → backend returns the existing booking. If the key were backend-generated, the frontend wouldn't know what key to retry with.

**Q5: Why separate `BaseScheduleTrip` and `Trip` tables instead of a `isTemplate` boolean on Trip?**  
A boolean approach means the refresh operation must query the same table it's writing to, creating a risk of accidentally modifying template rows. With separate tables, `refreshWeeklySchedule()` reads from one table and writes to another — it's structurally impossible to corrupt the template, no matter what bugs exist in the refresh logic.

**Q6: Why is the email sent outside the transaction, not inside?**  
If the email fails inside the transaction, the entire booking would roll back — the user would lose a confirmed, paid booking because of a transient email delivery failure. Email is fire-and-forget: called after the transaction commits, with errors caught and logged but never propagated.

**Q7: Why Groq over OpenAI for the analytics agent?**  
Groq uses an OpenAI-compatible tool-calling API shape, so the swap cost is near-zero (change one function: `callGroq()`). Groq offers free-tier access and fast inference for the model used (`qwen/qwen3.8-27b`). The architecture is provider-agnostic by design — only `callGroq()` references the Groq SDK.

**Q8: Why tool-calling over RAG for the analytics agent?**  
Our data is fully structured in Postgres — exact aggregates (utilization ratios, contention rates) are faster, more precise, and more auditable than embedding booking records into vectors and doing similarity search. RAG is for unstructured knowledge (PDFs, docs). Direct Prisma queries give deterministic, reproducible results.

**Q9: Why is there no `InitiatedBy` (USER/AGENT) enum on Booking?**  
**Honest answer — the agentic booking assistant (FR16-FR20) was not implemented.** The codebase has an analytics agent instead. Adding `InitiatedBy` would be trivial (add enum + field to Booking) when the booking assistant is built. This is a known gap.

**Q10: Why does the refresh token not rotate on each use?**  
Simplification for a single-device college app. Full rotation (delete old token, create new one, return new token) adds complexity and a race condition if the response with the new token is lost — the client has no valid token anymore. The current approach is safer for the use case at the cost of a slightly longer window if a refresh token is compromised (mitigated by the 7-day TTL and server-side revocation).

**Q11: Why is EC12 (cross-referencing tools) enforced via prompt, not code?**  
Honest trade-off. Counting distinct tool calls in code is possible but brittle — the model might call the same tool twice with different parameters, and that should still count. The system prompt is the simpler mechanism. A production system could add a validator in `persistRecommendations()` that rejects if the conversation history shows fewer than 2 distinct tool calls.

**Q12: Why no rate limiting on the booking endpoints?**  
Not implemented. In production, you'd add rate limiting (e.g., express-rate-limit) on `/booking/hold` and `/booking/confirm` to prevent abuse. The Redis Lua script prevents concurrent holds on the same seat, but doesn't limit how fast a single user can spam hold attempts on different seats.

**Q13: What happens if Redis goes down?**  
The hold service will throw an error (ioredis `maxRetriesPerRequest: 3`). Users can't hold seats until Redis is back. Already-confirmed bookings are safe in Postgres. Passive reconciliation will stop working (can't check Redis for expired holds), so some seats may appear stuck as HELD until Redis recovers. This is a known limitation — in production, Redis Sentinel or Cluster would be used.

**Q14: Why `uuid` for IDs instead of auto-increment?**  
UUIDs are globally unique without coordination — no sequence conflicts in multi-region or microservice scenarios. They don't leak information about row count or ordering. The slight performance cost of a larger index is acceptable for this scale.

---

## 9. Known Gaps / What I'd Improve With More Time

1. **No agentic booking assistant.** FR16-FR20 specify a user-facing conversational agent with `searchTrips`, `holdSeat`, `respondToUser` tools. What's implemented is an admin-facing analytics agent. The booking assistant would need to be built as a separate module.

2. **No `InitiatedBy` enum.** Without the booking assistant, there's no need to distinguish USER vs AGENT bookings. Would need to be added alongside the assistant.

3. **Refresh token not rotated.** The spec says "JWT access/refresh rotation" but refresh tokens are reused until expiry. Rotation would require atomic delete-and-create with the new token returned to the client.

4. **EC12 and EC13 are prompt-enforced, not code-enforced.** The system prompt tells the model to cross-reference tools and check special-trip frequency before recommending removal, but the code doesn't reject recommendations that violate these rules. A production system should add validators in `persistRecommendations()`.

5. **No input validation middleware.** Request body validation is done ad-hoc in controllers (`if (!name || !email || !password)`). A schema validator (Zod, Joi) would catch malformed requests earlier and produce consistent error shapes.

6. **No rate limiting.** No express-rate-limit or similar on any endpoint. A malicious user could spam hold attempts.

7. **No automated tests.** There are no test files in the codebase. The booking confirmation flow (the most critical path) particularly needs integration tests that exercise the Redis Lua + Postgres transaction interplay.

8. **Passive reconciliation is lazy.** Expired holds are only cleaned up when someone fetches the seat map. If no one views a trip's seat map for an hour after a hold expires, the seat appears HELD in Postgres (though the Redis key is gone). An active cleanup job (e.g., a cron that scans HELD seats against Redis every 60s) would reduce staleness.

9. **Email `to` field uses `tripId` instead of user email.** `confirm.service.js:168` passes `booking.seat.trip.id` as the `to` field — this is not a real email address. Should be the user's email (requires joining the user in the query or passing it separately).

10. **`Booking.seatId` is `@unique` — prevents rebooking a cancelled seat.** If a seat's booking is cancelled, the `seatId` unique constraint means no new booking can reference that seat. The Prisma model ties Booking to Seat as 1:1 via `@unique`, which means each seat can only ever have one Booking row. For cancelled seats to be rebooked, this would need to be changed to a non-unique FK with an application-level check that only one CONFIRMED booking exists per seat.

11. **No WebSocket authentication.** The Socket.io connection in `sockets/index.js` doesn't verify the JWT. Any client can connect and join any trip room. In production, the `connection` handler should verify the token from the handshake.

12. **Frontend generates a fresh idempotency key per attempt.** `ConfirmPay.jsx:34` creates `const idempotencyKey = uuidv4()` inside `handlePay()`. This means a page refresh + re-click generates a **new** key, which defeats idempotency across true retries. The key should be generated once when the hold is granted and reused across retries.

13. **No graceful handling of the `HELD → rebooked` race in the Booking model.** Because `Booking.seatId` is `@unique`, if a seat is cancelled and then someone else tries to book it, the create would fail with P2002 on seatId. The cancellation code sets the seat back to AVAILABLE, but the old Booking row still holds the unique FK. This is a real bug that would surface in production.

14. **Analytics agent model (`qwen/qwen3.8-27b`) hardcoded.** The model name is a string literal in `callGroq()`. Should be configurable via env var for easy swapping.

15. **`totalSeats` on Bus is not used in seat generation.** `generateSeatNumbers()` in `schedule.service.js` always generates 60 seats (10 rows x 6 columns). The `Bus.totalSeats` field defaults to 60 but is never read during seat creation — if a bus had `totalSeats: 40`, it would still get 60 seats.
