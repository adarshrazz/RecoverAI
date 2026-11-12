const express = require("express");
const router = express.Router();

const authenticateToken = require("../middleware/authMiddleware");

const {
    createRecoveryRecommendation,
    getRecoveryRecommendations,
    createRecoveryAction,
    updateRecoveryActionStatus,
    getRecoveryActions,
    updateRecoveryActionDetails,
    createRecoveryCheckout,
    captureRecoveryPayment,
    analyzePaymentWithAI,
    generateAIRecoveryMessage
} = require("../controllers/recoveryController");

// All recovery routes require authentication.
router.use(authenticateToken);

router.get("/", getRecoveryRecommendations);
router.get("/actions", getRecoveryActions);

// Generate a rule-based recovery recommendation.
router.post(
    "/payments/:id/recommendation",
    createRecoveryRecommendation
);

// Phase 4: AI-powered payment analysis and message drafting.
router.post(
    "/payments/:id/ai-analysis",
    analyzePaymentWithAI
);

router.post(
    "/payments/:id/ai-message",
    generateAIRecoveryMessage
);

// Create a recovery action from a recommendation.
router.post(
    "/recommendations/:recommendationId/actions",
    createRecoveryAction
);

// PayPal recovery checkout and capture.
router.post(
    "/actions/:actionId/checkout",
    createRecoveryCheckout
);

router.post(
    "/actions/:actionId/capture",
    captureRecoveryPayment
);

// Recovery action management.
router.patch(
    "/actions/:actionId/status",
    updateRecoveryActionStatus
);

router.patch(
    "/actions/:actionId/details",
    updateRecoveryActionDetails
);

module.exports = router;
