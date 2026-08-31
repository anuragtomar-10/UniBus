const { Router } = require("express");
const { verifyToken } = require("../../middleware/auth");
const c = require("./booking.controller");

const router = Router();

router.post("/booking/hold", verifyToken, c.hold);         // FR12
router.post("/booking/release", verifyToken, c.release);   // Manual release
router.post("/booking/confirm", verifyToken, c.confirm);   // FR13
router.post("/booking/:id/cancel", verifyToken, c.cancel); // FR14
router.get("/bookings/history", verifyToken, c.history);   // FR18

module.exports = router;
