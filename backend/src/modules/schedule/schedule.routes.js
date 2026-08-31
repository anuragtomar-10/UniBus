const { Router } = require("express");
const { verifyToken, requireAdmin } = require("../../middleware/auth");
const c = require("./schedule.controller");

const router = Router();

// Base schedule CRUD (admin-only, FR5)
router.get("/admin/schedule/base", verifyToken, requireAdmin, c.listBaseTrips);
router.post("/admin/schedule/base", verifyToken, requireAdmin, c.createBaseTrip);
router.patch("/admin/schedule/base/:id", verifyToken, requireAdmin, c.updateBaseTrip);
router.delete("/admin/schedule/base/:id", verifyToken, requireAdmin, c.deleteBaseTrip);

// Weekly refresh (admin-only, FR6)
router.post("/admin/schedule/refresh", verifyToken, requireAdmin, c.refreshSchedule);

// Special trips (admin-only, FR8)
router.post("/admin/trips/special", verifyToken, requireAdmin, c.createSpecialTrip);

// Reference data for admin forms
router.get("/admin/buses", verifyToken, requireAdmin, c.listBuses);
router.get("/admin/drivers", verifyToken, requireAdmin, c.listDrivers);

module.exports = router;
