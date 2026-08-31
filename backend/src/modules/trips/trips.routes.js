const { Router } = require("express");
const { verifyToken } = require("../../middleware/auth");
const { search, seatMap, weeklySchedule } = require("./trips.controller");

const router = Router();

// Weekly schedule — all trips this week grouped by date
router.get("/week", verifyToken, weeklySchedule);

// FR10: search by date (and optionally time / destination)
router.get("/search", verifyToken, search);

// FR11: seat map with live status
router.get("/:id/seats", verifyToken, seatMap);

module.exports = router;
