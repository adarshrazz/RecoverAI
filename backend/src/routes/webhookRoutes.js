
const express = require("express");

const router = express.Router();

const {
    handlePayPalWebhook
} = require("../controllers/webhookController");

// PayPal webhook endpoint
// No JWT authentication: PayPal authenticates through signature verification.
router.post("/", handlePayPalWebhook);

module.exports = router;
