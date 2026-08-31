/**
 * Schedule service — base template CRUD, weekly refresh, special trips.
 *
 * Key architectural invariants preserved here:
 *
 * 1. BaseScheduleTrip and Trip are structurally separate tables (FR5, NFR10).
 *    This function only ever calls prisma.trip.create — never update/delete on Trip.
 *    Editing the base template is impossible to accidentally propagate to existing trips.
 *
 * 2. Refresh is additive only (FR6, EC1):
 *    - Never deletes or modifies existing Trip rows
 *    - Idempotent: skips dates that already have BASE-sourced trips
 *    - Runs only create, never update/delete
 *
 * 3. Special trips do not touch the base template (FR8, FR9):
 *    - source: SPECIAL, baseScheduleTripId: null
 *    - Not recreated on next refresh (which generates strictly from base template)
 *
 * 4. EC6 (deliberate design choice — ALLOW multiple holds across different trips):
 *    The same user CAN hold seats on multiple different trips simultaneously.
 *    Reasoning: booking a bus doesn't preclude booking another bus on a different
 *    route/time — these are genuinely independent transactions. Blocking this would
 *    hurt legitimate use (e.g., booking a morning and evening trip). We only
 *    prevent the same seat from being double-booked.
 */

const prisma = require("../../config/prisma");

// ─── Seat generation ──────────────────────────────────────────────────────────
// Fixed 60-seat layout: rows 1–10, columns A–F
// Used both by weekly refresh and special-trip creation (same function, same tx)
const SEAT_LETTERS = ["A", "B", "C", "D", "E", "F"];
const TOTAL_ROWS = 10;

function generateSeatNumbers() {
  const seats = [];
  for (let row = 1; row <= TOTAL_ROWS; row++) {
    for (const letter of SEAT_LETTERS) {
      seats.push(`${row}${letter}`);
    }
  }
  return seats; // "1A".."10F", 60 seats
}

// ─── Base Template CRUD ───────────────────────────────────────────────────────

async function listBaseTrips() {
  return prisma.baseScheduleTrip.findMany({
    where: { isActive: true },
    include: { bus: true, driver: true },
    orderBy: [{ dayOfWeek: "asc" }, { departureTime: "asc" }],
  });
}

async function createBaseTrip(data) {
  return prisma.baseScheduleTrip.create({
    data,
    include: { bus: true, driver: true },
  });
}

async function updateBaseTrip(id, data) {
  // EC2: base template edits never retroactively affect existing Trip rows.
  // This update only modifies the template — the separation of tables guarantees this.
  return prisma.baseScheduleTrip.update({
    where: { id },
    data,
    include: { bus: true, driver: true },
  });
}

async function deleteBaseTrip(id) {
  // Soft delete — set isActive:false so historical reference is preserved
  return prisma.baseScheduleTrip.update({
    where: { id },
    data: { isActive: false },
  });
}

// ─── Weekly Refresh ───────────────────────────────────────────────────────────

/**
 * Returns all 6 operating dates for the CURRENT Mon–Sat week.
 * Used by both refreshWeeklySchedule (so refresh works any day of the week)
 * and by the seed to pre-populate this week's trips.
 */
function getThisWeekDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=Sun
  // Mon of this week
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));

  const dates = [];
  for (let i = 0; i < 6; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    date.setHours(0, 0, 0, 0);
    dates.push({ date, dayOfWeek: i + 1 }); // 1=Mon..6=Sat
  }
  return dates;
}

/**
 * Compute the next 6 operating dates (Mon–Sat) starting from NEXT Monday.
 * Kept for backwards-compat but refresh now uses getThisWeekDates.
 */
function getNextWeekDates() {
  const today = new Date();
  const dates = [];
  let d = new Date(today);

  // Advance to next Monday
  const todayDow = d.getDay(); // 0=Sun
  const daysUntilMonday = todayDow === 0 ? 1 : 8 - todayDow;
  d.setDate(d.getDate() + daysUntilMonday);

  // Collect Mon–Sat (6 days)
  for (let i = 0; i < 6; i++) {
    const date = new Date(d);
    date.setHours(0, 0, 0, 0);
    dates.push({ date, dayOfWeek: i + 1 }); // 1=Mon..6=Sat
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/**
 * FR6: Manual weekly refresh — generates bookable Trip + Seat records for next Mon–Sat.
 * - Additive only: never deletes/modifies existing Trip rows (EC1)
 * - Idempotent: skips dates that already have BASE trips (EC1)
 * - Intended for Sunday but not time-gated in code (don't block testing/demo)
 */
async function refreshWeeklySchedule() {
  // Refresh BOTH current week and next week so clicking the button always
  // produces visible results regardless of which day of the week it is run.
  const thisWeek = getThisWeekDates();
  const nextWeek = getNextWeekDates();
  // Deduplicate in case today is Monday (thisWeek[0] === nextWeek[0])
  const seen = new Set();
  const weekDates = [...thisWeek, ...nextWeek].filter(({ date }) => {
    const k = date.toISOString().split("T")[0];
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const results = { created: [], skipped: [] };

  for (const { date, dayOfWeek } of weekDates) {
    // Idempotency check: skip if BASE trips already exist for this date (EC1)
    const existingCount = await prisma.trip.count({
      where: {
        date,
        source: "BASE",
      },
    });

    if (existingCount > 0) {
      results.skipped.push(date.toISOString().split("T")[0]);
      continue;
    }

    // Fetch active base trips for this day of week
    const baseTrips = await prisma.baseScheduleTrip.findMany({
      where: { dayOfWeek, isActive: true },
    });

    for (const baseTrip of baseTrips) {
      const seatNumbers = generateSeatNumbers();

      // Create Trip + all 60 Seats in a single transaction
      // This function only ever calls create — never update/delete on Trip (NFR10)
      await prisma.$transaction(async (tx) => {
        const trip = await tx.trip.create({
          data: {
            date,
            origin: baseTrip.origin,
            destination: baseTrip.destination,
            departureTime: baseTrip.departureTime,
            busId: baseTrip.busId,
            driverId: baseTrip.driverId,
            source: "BASE",
            baseScheduleTripId: baseTrip.id,
          },
        });

        await tx.seat.createMany({
          data: seatNumbers.map((seatNumber) => ({
            tripId: trip.id,
            seatNumber,
            status: "AVAILABLE",
          })),
        });
      });

      results.created.push(
        `${date.toISOString().split("T")[0]} ${baseTrip.origin}→${baseTrip.destination} ${baseTrip.departureTime}`
      );
    }
  }

  return results;
}

// ─── Special Trips ────────────────────────────────────────────────────────────

/**
 * FR8: Create a special/extra trip for a specific date+time.
 * - source: SPECIAL, baseScheduleTripId: null
 * - Validates no bus/driver conflict (EC3)
 * - The @@unique constraints on Trip are the final DB-level backstop for EC3
 * - Special trips are non-persistent: next refresh won't recreate them (FR9)
 */
async function createSpecialTrip({
  date,
  origin,
  destination,
  departureTime,
  busId,
  driverId,
}) {
  const tripDate = new Date(date);
  tripDate.setHours(0, 0, 0, 0);
  const seatNumbers = generateSeatNumbers();

  // EC3: App-level conflict check (DB @@unique is the backstop)
  const conflict = await prisma.trip.findFirst({
    where: {
      date: tripDate,
      departureTime,
      OR: [{ busId }, { driverId }],
    },
  });

  if (conflict) {
    const err = new Error(
      `Bus or driver already assigned to a trip at ${date} ${departureTime}`
    );
    err.status = 409;
    throw err;
  }

  return prisma.$transaction(async (tx) => {
    const trip = await tx.trip.create({
      data: {
        date: tripDate,
        origin,
        destination,
        departureTime,
        busId,
        driverId,
        source: "SPECIAL",
        baseScheduleTripId: null,
      },
      include: { bus: true, driver: true },
    });

    await tx.seat.createMany({
      data: seatNumbers.map((seatNumber) => ({
        tripId: trip.id,
        seatNumber,
        status: "AVAILABLE",
      })),
    });

    return trip;
  });
}

// ─── Buses + Drivers (for admin form dropdowns) ───────────────────────────────
async function listBuses() {
  return prisma.bus.findMany();
}

async function listDrivers() {
  return prisma.driver.findMany();
}

module.exports = {
  listBaseTrips,
  createBaseTrip,
  updateBaseTrip,
  deleteBaseTrip,
  refreshWeeklySchedule,
  createSpecialTrip,
  listBuses,
  listDrivers,
  getThisWeekDates,   // exported for use by the seed script
};
