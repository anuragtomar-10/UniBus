const { Router } = require("express");
const { verifyToken, requireAdmin } = require("../../middleware/auth");
const { getAuditHistory } = require("./audit.controller");

const router = Router();

// FR17: Admin reconstructs full booking history for debugging
router.get("/audit/:bookingId", verifyToken, requireAdmin, getAuditHistory);

module.exports = router;
