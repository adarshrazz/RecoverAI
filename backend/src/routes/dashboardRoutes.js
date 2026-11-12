
const express = require("express");

const router = express.Router();

const {
    getDashboardSummary,
    getDashboardPerformance
} = require("../controllers/dashboardController");

const authenticateToken = require("../middleware/authMiddleware");

// Protect all dashboard routes
router.use(authenticateToken);

// Dashboard summary
router.get("/summary", getDashboardSummary);

// Dashboard performance
router.get("/performance", getDashboardPerformance);

module.exports = router;
