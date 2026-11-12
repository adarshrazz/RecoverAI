
const pool = require("../config/database");

// GET DASHBOARD SUMMARY
const getDashboardSummary = async (req, res) => {
    try {
        const merchantId = req.user.userId;

        // Payment counts and success rate
        const summaryResult = await pool.query(
            `SELECT
                COUNT(*)::INTEGER AS total_payments,

                COUNT(*) FILTER (
                    WHERE status = 'completed'
                )::INTEGER AS successful_payments,

                COUNT(*) FILTER (
                    WHERE status = 'failed'
                )::INTEGER AS failed_payments,

                COUNT(*) FILTER (
                    WHERE status = 'pending'
                )::INTEGER AS pending_payments,

                COUNT(*) FILTER (
                    WHERE status = 'cancelled'
                )::INTEGER AS cancelled_payments,

                COALESCE(
                    ROUND(
                        100.0 * COUNT(*) FILTER (
                            WHERE status = 'completed'
                        ) / NULLIF(COUNT(*), 0),
                        2
                    ),
                    0
                ) AS success_rate

             FROM payments
             WHERE merchant_id = $1`,
            [merchantId]
        );

        // Financial totals grouped by currency
        // Never combine different currencies into one total.
        const financialResult = await pool.query(
            `SELECT
                currency,

                COALESCE(
                    SUM(amount) FILTER (
                        WHERE status = 'completed'
                    ), 0
                ) AS completed_revenue,

                COALESCE(SUM(amount), 0) AS total_payment_volume,

                COALESCE(
                    SUM(amount) FILTER (
                        WHERE status = 'failed'
                    ), 0
                ) AS failed_payment_value,

                COALESCE(
                    SUM(amount) FILTER (
                        WHERE status = 'pending'
                    ), 0
                ) AS pending_payment_value

             FROM payments
             WHERE merchant_id = $1
             GROUP BY currency
             ORDER BY currency`,
            [merchantId]
        );

        return res.status(200).json({
            success: true,
            summary: summaryResult.rows[0],
            financials: financialResult.rows
        });

    } catch (error) {
        console.error("Dashboard summary error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve dashboard summary"
        });
    }
};


// GET DASHBOARD PERFORMANCE
const getDashboardPerformance = async (req, res) => {
    try {
        const merchantId = req.user.userId;
        const days = Number(req.query.days || 7);

        // Allow only 7-day or 30-day reports
        if (![7, 30].includes(days)) {
            return res.status(400).json({
                success: false,
                message: "Days must be either 7 or 30"
            });
        }

        // Daily payment counts
        const performanceResult = await pool.query(
            `WITH dates AS (
                SELECT generate_series(
                    CURRENT_DATE - ($2::INTEGER - 1),
                    CURRENT_DATE,
                    INTERVAL '1 day'
                )::DATE AS day
            )
            SELECT
                d.day,

                COUNT(p.id)::INTEGER AS total_payments,

                COUNT(p.id) FILTER (
                    WHERE p.status = 'completed'
                )::INTEGER AS successful_payments,

                COUNT(p.id) FILTER (
                    WHERE p.status = 'failed'
                )::INTEGER AS failed_payments,

                COUNT(p.id) FILTER (
                    WHERE p.status = 'pending'
                )::INTEGER AS pending_payments

            FROM dates d

            LEFT JOIN payments p
                ON p.merchant_id = $1
                AND p.created_at >= d.day
                AND p.created_at < d.day + INTERVAL '1 day'

            GROUP BY d.day
            ORDER BY d.day ASC`,
            [merchantId, days]
        );

        // Daily completed revenue, separated by currency
        const revenueResult = await pool.query(
            `SELECT
                DATE(created_at) AS day,
                currency,
                SUM(amount) AS completed_revenue

            FROM payments

            WHERE merchant_id = $1
                AND status = 'completed'
                AND created_at >= CURRENT_DATE - ($2::INTEGER - 1)
                AND created_at < CURRENT_DATE + INTERVAL '1 day'

            GROUP BY DATE(created_at), currency
            ORDER BY day ASC, currency ASC`,
            [merchantId, days]
        );

        return res.status(200).json({
            success: true,
            period_days: days,
            performance: performanceResult.rows,
            revenue_trends: revenueResult.rows
        });

    } catch (error) {
        console.error(
            "Dashboard performance error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve dashboard performance"
        });
    }
};


module.exports = {
    getDashboardSummary,
    getDashboardPerformance
};
