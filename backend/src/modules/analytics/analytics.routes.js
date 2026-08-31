const { Router } = require("express");
const { verifyToken, requireAdmin } = require("../../middleware/auth");
const { runInsights, getRecommendations, updateRecommendation } = require("./analytics.controller");

const router = Router();

// All analytics routes require admin authentication
router.use(verifyToken, requireAdmin);

// POST /admin/analytics/insights — trigger agent loop
router.post("/insights", runInsights);

// GET /admin/analytics/recommendations?status=PENDING|ACCEPTED|DISMISSED
router.get("/recommendations", getRecommendations);

// PATCH /admin/analytics/recommendations/:id — accept or dismiss
router.patch("/recommendations/:id", updateRecommendation);

module.exports = router;
