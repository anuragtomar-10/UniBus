const { runAnalyticsTurn } = require("./agent");
const { listRecommendations, reviewRecommendation } = require("./recommendation.service");

/**
 * POST /admin/analytics/insights
 * Body: { lookbackWeeks? }
 * Triggers the Groq agent loop and returns its results.
 */
async function runInsights(req, res, next) {
  try {
    const { lookbackWeeks } = req.body;
    const result = await runAnalyticsTurn(lookbackWeeks);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /admin/analytics/recommendations?status=
 * Returns recommendations, optionally filtered by status.
 */
async function getRecommendations(req, res, next) {
  try {
    const { status } = req.query;
    const recommendations = await listRecommendations(status);
    res.json(recommendations);
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /admin/analytics/recommendations/:id
 * Body: { status: "ACCEPTED" | "DISMISSED" }
 * Reviews (accepts or dismisses) a recommendation.
 */
async function updateRecommendation(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const updated = await reviewRecommendation(id, status);
    res.json(updated);
  } catch (err) {
    next(err);
  }
}

module.exports = { runInsights, getRecommendations, updateRecommendation };
