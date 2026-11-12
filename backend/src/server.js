// ============================================
// RecoverAI Backend - Server Configuration
// ============================================

// Load environment variables
require("dotenv").config();

// Import dependencies
const express = require("express");
const cors = require("cors");

// Import database connection
const pool = require("./config/database");

// Import API routes
const authRoutes = require("./routes/authRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const recoveryRoutes = require("./routes/recoveryRoutes");

// Initialize Express application
const app = express();

const dashboardRoutes = require("./routes/dashboardRoutes");

const webhookRoutes = require("./routes/webhookRoutes");

// ============================================
// MIDDLEWARE
// ============================================

app.use(cors());
app.use(express.json());

// ============================================
// API ROUTES
// ============================================

// Authentication routes
// app.use("/api/auth", authRoutes);

// Payment management routes
// app.use("/api/payments", paymentRoutes);
// API Routes
app.use("/api/auth", authRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/recovery", recoveryRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/webhooks/paypal", webhookRoutes);

// ============================================
// WELCOME ROUTE
// ============================================

app.get("/", (req, res) => {
    res.status(200).json({
        success: true,
        message: "Welcome to RecoverAI API"
    });
});

// ============================================
// SERVER HEALTH CHECK
// ============================================

app.get("/api/health", (req, res) => {
    res.status(200).json({
        success: true,
        message: "RecoverAI backend is running",
        timestamp: new Date().toISOString()
    });
});

// ============================================
// DATABASE HEALTH CHECK
// ============================================

app.get("/api/db-health", async (req, res) => {
    try {
        const result = await pool.query(
    "SELECT NOW() AS current_time, current_database()"
);

        res.status(200).json({
            success: true,
            message: "PostgreSQL connected successfully",
            // database: process.env.PGDATABASE,
            database: result.rows[0].current_database,
            time: result.rows[0].current_time
        });

    } catch (error) {
        console.error("Database health check error:", error.message);

        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});

// ============================================
// 404 ROUTE
// ============================================

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "API endpoint not found"
    });
});

// ============================================
// GLOBAL ERROR HANDLER
// ============================================

app.use((err, req, res, next) => {
    console.error("Server error:", err.message);

    res.status(500).json({
        success: false,
        message: "Internal server error"
    });
});

// ============================================
// START SERVER
// ============================================

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log("--------------------------------");
    console.log("       RecoverAI Backend        ");
    console.log("--------------------------------");
    console.log(`Server running on port ${PORT}`);
    console.log(`URL: http://localhost:${PORT}`);
});
