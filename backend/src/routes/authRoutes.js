
const express = require("express");

const router = express.Router();

// Import authentication controller
const {
    register,
    login,
    getMe
} = require("../controllers/authController.js");

// Import authentication middleware
const authenticateToken = require("../middleware/authMiddleware.js");

// Public routes
router.post("/register", register);
router.post("/login", login);

// Protected route
router.get("/me", authenticateToken, getMe);

module.exports = router;
