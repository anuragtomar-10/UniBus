/**
 * Seed script for UniBus.
 * Creates: 3 Buses, 3 Drivers, 6 BaseScheduleTrips, this week's Trip rows.
 * Enough to demo all functionality immediately after `npm run db:seed`.
 *
 * Routes available:
 *   COLLEGE ↔ RAJA_PARK
 *   COLLEGE ↔ AJMERI_GATE
 */

const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// 60 seat labels "1A".."10F"
function generateSeatNumbers() {
  const seats = [];
  const letters = ["A", "B", "C", "D", "E", "F"];
  for (let row = 1; row <= 10; row++) {
    for (const l of letters) seats.push(`${row}${l}`);
  }
  return seats;
}

// Mon–Sat of the current week
function getThisWeekDates() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
  const dates = [];
  for (let i = 0; i < 6; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    date.setHours(0, 0, 0, 0);
    dates.push({ date, dayOfWeek: i + 1 });
  }
  return dates;
}

async function main() {
  console.log("🌱 Seeding database...");

  // ─── Buses ────────────────────────────────────────────────────────────────
  const buses = await Promise.all([
    prisma.bus.upsert({
      where: { registrationNo: "RJ14-UA-0001" },
      update: {},
      create: { registrationNo: "RJ14-UA-0001", totalSeats: 60 },
    }),
    prisma.bus.upsert({
      where: { registrationNo: "RJ14-UA-0002" },
      update: {},
      create: { registrationNo: "RJ14-UA-0002", totalSeats: 60 },
    }),
    prisma.bus.upsert({
      where: { registrationNo: "RJ14-UA-0003" },
      update: {},
      create: { registrationNo: "RJ14-UA-0003", totalSeats: 60 },
    }),
  ]);
  console.log(`✅ Created ${buses.length} buses`);

  // ─── Drivers ──────────────────────────────────────────────────────────────
  const drivers = await Promise.all([
    prisma.driver.upsert({
      where: { licenseNo: "RJ-0001-2020" },
      update: {},
      create: {
        name: "Ramesh Kumar",
        licenseNo: "RJ-0001-2020",
        phone: "9801234567",
      },
    }),
    prisma.driver.upsert({
      where: { licenseNo: "RJ-0002-2019" },
      update: {},
      create: {
        name: "Suresh Sharma",
        licenseNo: "RJ-0002-2019",
        phone: "9812345678",
      },
    }),
    prisma.driver.upsert({
      where: { licenseNo: "RJ-0003-2021" },
      update: {},
      create: {
        name: "Mahesh Verma",
        licenseNo: "RJ-0003-2021",
        phone: "9823456789",
      },
    }),
  ]);
  console.log(`✅ Created ${drivers.length} drivers`);

  // ─── Base Schedule Trips ───────────────────────────────────────────────────
  const baseTripsInput = [
    { dayOfWeek: 1, origin: "COLLEGE", destination: "RAJA_PARK",   departureTime: "08:00", busId: buses[0].id, driverId: drivers[0].id },
    { dayOfWeek: 3, origin: "COLLEGE", destination: "RAJA_PARK",   departureTime: "08:00", busId: buses[0].id, driverId: drivers[0].id },
    { dayOfWeek: 5, origin: "COLLEGE", destination: "RAJA_PARK",   departureTime: "08:00", busId: buses[0].id, driverId: drivers[0].id },
    { dayOfWeek: 2, origin: "COLLEGE", destination: "AJMERI_GATE", departureTime: "09:00", busId: buses[1].id, driverId: drivers[1].id },
    { dayOfWeek: 4, origin: "COLLEGE", destination: "AJMERI_GATE", departureTime: "09:00", busId: buses[1].id, driverId: drivers[1].id },
    { dayOfWeek: 6, origin: "COLLEGE", destination: "AJMERI_GATE", departureTime: "09:00", busId: buses[1].id, driverId: drivers[1].id },
    { dayOfWeek: 1, origin: "RAJA_PARK",   destination: "COLLEGE", departureTime: "17:00", busId: buses[2].id, driverId: drivers[2].id },
    { dayOfWeek: 3, origin: "RAJA_PARK",   destination: "COLLEGE", departureTime: "17:00", busId: buses[2].id, driverId: drivers[2].id },
  ];

  const createdBaseTrips = [];
  for (const trip of baseTripsInput) {
    try {
      const created = await prisma.baseScheduleTrip.create({ data: trip });
      createdBaseTrips.push(created);
    } catch (e) {
      if (e.code !== "P2002") throw e;
      // Already exists — fetch it so we can use it for trip generation
      const existing = await prisma.baseScheduleTrip.findFirst({
        where: { dayOfWeek: trip.dayOfWeek, busId: trip.busId, driverId: trip.driverId },
      });
      if (existing) createdBaseTrips.push(existing);
    }
  }
  console.log(`✅ Created/found ${createdBaseTrips.length} base schedule trips`);

  // ─── Generate actual Trip rows for THIS week ────────────────────────────────
  // This is the key step — without it the weekly schedule page shows "No buses".
  // The admin "Refresh week" button also does this (and is idempotent).
  const weekDates = getThisWeekDates();
  let tripsCreated = 0;

  for (const { date, dayOfWeek } of weekDates) {
    const existingCount = await prisma.trip.count({ where: { date, source: "BASE" } });
    if (existingCount > 0) continue; // idempotent

    const dayBaseTrips = createdBaseTrips.filter((bt) => bt.dayOfWeek === dayOfWeek);
    for (const baseTrip of dayBaseTrips) {
      const seatNumbers = generateSeatNumbers();
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
      tripsCreated++;
    }
  }
  console.log(`✅ Created ${tripsCreated} trips for this week (${weekDates[0].date.toDateString()} – ${weekDates[5].date.toDateString()})`);

  // ─── Admin user ───────────────────────────────────────────────────────────
  const bcrypt = require("bcrypt");
  const adminHash = await bcrypt.hash("admin123", 12);
  try {
    await prisma.user.create({
      data: { name: "Admin User", email: "admin@unibus.local", passwordHash: adminHash, role: "ADMIN" },
    });
    console.log("✅ Created admin user  →  admin@unibus.local / admin123");
  } catch (e) {
    if (e.code !== "P2002") throw e;
    console.log("ℹ️  Admin user already exists");
  }

  // ─── Demo student ─────────────────────────────────────────────────────────
  const studentHash = await bcrypt.hash("student123", 12);
  try {
    await prisma.user.create({
      data: { name: "Demo Student", email: "student@unibus.local", passwordHash: studentHash, role: "STUDENT" },
    });
    console.log("✅ Created demo student  →  student@unibus.local / student123");
  } catch (e) {
    if (e.code !== "P2002") throw e;
    console.log("ℹ️  Demo student already exists");
  }

  console.log("\n🎉 Seed complete!");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
