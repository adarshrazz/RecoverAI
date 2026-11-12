const express = require("express");

const router = express.Router();

const {
    getPayments,
    getPaymentById,
    getPaymentAttempts,
    createPayPalOrder,
    checkPayPalOrder,
    capturePayPalPayment
} = require("../controllers/paymentController");

const authenticateToken = require("../middleware/authMiddleware");

// All payment routes require authentication
router.use(authenticateToken);

// Create PayPal Sandbox order
router.post("/paypal/orders", createPayPalOrder);

// Get payment attempts
router.get("/:id/attempts", getPaymentAttempts);

// Capture approved PayPal payment
router.post("/:id/capture", capturePayPalPayment);

// Get all payments
router.get("/", getPayments);

router.get("/:id/paypal-status", checkPayPalOrder);

// Capture approved PayPal payment
// router.post("/:id/capture", capturePayPalPayment);

// Get individual payment details
router.get("/:id", getPaymentById);

module.exports = router;
