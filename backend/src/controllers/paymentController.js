const pool = require("../config/database");
const classifyPayPalFailure = (issue) => {
    const categories = {
        INSTRUMENT_DECLINED: "CARD_DECLINED",
        PAYER_ACTION_REQUIRED: "AUTHENTICATION_REQUIRED",
        INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
        CARD_EXPIRED: "PAYMENT_METHOD_EXPIRED"
    };

    return categories[issue] || "UNKNOWN_FAILURE";
};

const {
    createOrder,
    getOrder,
    captureOrder
} = require("../services/paypalService");

// GET ALL PAYMENTS FOR LOGGED-IN MERCHANT
const getPayments = async (req, res) => {
    try {
        const merchantId = req.user.userId;

        const { status, search, page = 1, limit = 10, sort = "new" } = req.query;

        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const pageLimit = Math.min(
            100,
            Math.max(1, parseInt(limit, 10) || 10)
        );

        const offset = (currentPage - 1) * pageLimit;

        const conditions = ["p.merchant_id = $1"];
        const values = [merchantId];

        const allowedStatuses = ["pending", "approved", "completed", "failed", "cancelled", "refunded", "requires_action"];
        if (status && status !== "All") {
            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: "Invalid payment status filter" });
            }
            values.push(status);
            conditions.push(`p.status = $${values.length}`);
        }

        if (search && search.trim()) {
            values.push(`%${search.trim()}%`);
            conditions.push(
                `(c.name ILIKE $${values.length}
                  OR c.email ILIKE $${values.length}
                  OR p.paypal_order_id ILIKE $${values.length}
                  OR p.paypal_capture_id ILIKE $${values.length}
                  OR p.description ILIKE $${values.length})`
            );
        }

        const whereClause = conditions.join(" AND ");
        const orderBy = {
            new: "p.created_at DESC, p.id DESC",
            amount: "p.amount DESC, p.created_at DESC",
            priority: "CASE WHEN p.status = 'failed' AND p.amount >= 300 THEN 3 WHEN p.status IN ('failed', 'pending') THEN 2 ELSE 1 END DESC, p.amount DESC, p.created_at DESC"
        }[sort] || "p.created_at DESC, p.id DESC";

        const countResult = await pool.query(
            `SELECT COUNT(*) 
             FROM payments p
             JOIN customers c
               ON c.id = p.customer_id
              AND c.merchant_id = p.merchant_id
             WHERE ${whereClause}`,
            values
        );

        const paymentsResult = await pool.query(
            `SELECT
                p.id,
                p.paypal_order_id,
                p.paypal_capture_id,
                p.amount,
                p.currency,
                p.status,
                p.description,
                p.created_at,
                p.updated_at,
                c.name AS customer_name,
                c.email AS customer_email
             FROM payments p
             JOIN customers c
               ON c.id = p.customer_id
              AND c.merchant_id = p.merchant_id
             WHERE ${whereClause}
             ORDER BY ${orderBy}
             LIMIT $${values.length + 1}
             OFFSET $${values.length + 2}`,
            [...values, pageLimit, offset]
        );

        return res.status(200).json({
            success: true,
            total: parseInt(countResult.rows[0].count, 10),
            page: currentPage,
            limit: pageLimit,
            total_pages: Math.ceil(parseInt(countResult.rows[0].count, 10) / pageLimit),
            sort,
            payments: paymentsResult.rows
        });

    } catch (error) {
        console.error("Get payments error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve payments"
        });
    }
};


// GET SINGLE PAYMENT DETAILS
const getPaymentById = async (req, res) => {
    try {
        const merchantId = req.user.userId;
        const { id } = req.params;

        if (!/^\d+$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment ID"
            });
        }

        const result = await pool.query(
            `SELECT
                p.*,
                c.name AS customer_name,
                c.email AS customer_email,
                c.phone AS customer_phone
             FROM payments p
             JOIN customers c
               ON c.id = p.customer_id
              AND c.merchant_id = p.merchant_id
             WHERE p.id = $1
               AND p.merchant_id = $2`,
            [id, merchantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        return res.status(200).json({
            success: true,
            payment: result.rows[0]
        });

    } catch (error) {
        console.error("Get payment error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve payment details"
        });
    }
};


// GET PAYMENT ATTEMPT HISTORY FOR A MERCHANT-OWNED PAYMENT
const getPaymentAttempts = async (req, res) => {
    try {
        const merchantId = req.user.userId;
        const { id } = req.params;

        if (!/^\d+$/.test(id)) {
            return res.status(400).json({ success: false, message: "Invalid payment ID" });
        }

        // Check ownership before querying child records.
        const paymentResult = await pool.query(
            `SELECT id, created_at FROM payments WHERE id = $1 AND merchant_id = $2`,
            [id, merchantId]
        );

        if (paymentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Payment not found" });
        }

        const attemptsResult = await pool.query(
            `SELECT id, payment_id, attempt_number, status, failure_code,
                    failure_message, attempted_at
             FROM payment_attempts
             WHERE payment_id = $1
             ORDER BY attempt_number ASC, attempted_at ASC`,
            [id]
        );

        return res.status(200).json({
            success: true,
            payment_id: Number(id),
            payment_created_at: paymentResult.rows[0].created_at,
            total_attempts: attemptsResult.rows.length,
            attempts: attemptsResult.rows
        });
    } catch (error) {
        console.error("Get payment attempts error:", error.message);
        return res.status(500).json({ success: false, message: "Unable to retrieve payment attempts" });
    }
};


// CREATE PAYPAL SANDBOX ORDER
const createPayPalOrder = async (req, res) => {
    try {
        const merchantId = req.user.userId;

        const {
            customerId,
            amount,
            description
        } = req.body;

        // Validate customer ID
        if (!customerId || !/^\d+$/.test(String(customerId))) {
            return res.status(400).json({
                success: false,
                message: "A valid customer ID is required"
            });
        }

        // Validate amount
        const paymentAmount = Number(amount);

        if (
            !Number.isFinite(paymentAmount) ||
            paymentAmount <= 0 ||
            !/^\d+(\.\d{1,2})?$/.test(String(amount))
        ) {
            return res.status(400).json({
                success: false,
                message: "Enter a valid payment amount"
            });
        }

        // Verify customer belongs to logged-in merchant
        const customerResult = await pool.query(
            `SELECT id FROM customers
             WHERE id = $1 AND merchant_id = $2`,
            [customerId, merchantId]
        );

        if (customerResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Customer not found"
            });
        }

        // Create order with PayPal Sandbox
        const paypalOrder = await createOrder({
            amount: paymentAmount,
            currency: "USD",
            description: description || "RecoverAI Sandbox Payment",
            returnUrl:
                "http://127.0.0.1:5500/frontend/index.html?paypal=success",
            cancelUrl:
                "http://127.0.0.1:5500/frontend/index.html?paypal=cancel"
        });

        // Save order in PostgreSQL
        const paymentResult = await pool.query(
            `INSERT INTO payments
                (merchant_id, customer_id, paypal_order_id,
                 amount, currency, status, description)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, paypal_order_id, amount, currency, status`,
            [
                merchantId,
                customerId,
                paypalOrder.orderId,
                paymentAmount,
                "USD",
                "pending",
                description || "RecoverAI Sandbox Payment"
            ]
        );

        return res.status(201).json({
            success: true,
            message: "PayPal order created successfully",
            payment: paymentResult.rows[0],
            paypal: {
                orderId: paypalOrder.orderId,
                status: paypalOrder.status,
                approvalUrl: paypalOrder.approvalUrl
            }
        });

    } catch (error) {
        console.error("PayPal order creation error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to create PayPal order"
        });
    }
};


const checkPayPalOrder = async (req, res) => {
    try {
        const merchantId = req.user.userId;
        const { id } = req.params;

        if (!/^\d+$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment ID"
            });
        }

        const result = await pool.query(
            `SELECT id, paypal_order_id, status
             FROM payments
             WHERE id = $1 AND merchant_id = $2`,
            [id, merchantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = result.rows[0];

        if (!payment.paypal_order_id) {
            return res.status(400).json({
                success: false,
                message: "PayPal order ID not found"
            });
        }

        const paypalOrder = await getOrder(
            payment.paypal_order_id
        );

        return res.status(200).json({
            success: true,
            paymentId: payment.id,
            localStatus: payment.status,
            paypalOrder
        });

    
    } catch (error) {
    console.error("PayPal order check error:", error);

    return res.status(500).json({
        success: false,
        message: error.message || "Unable to check PayPal order"
    });
}
};



const capturePayPalPayment = async (req, res) => {

    let client;
    let attemptId = null;
    let paymentId = null;

    try {
        client = await pool.connect();

        const merchantId = req.user.userId;
        const { id } = req.params;

        if (!/^\d+$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment ID"
            });
        }

        // Add this line immediately below validation
        paymentId = Number(id);

        // Lock the payment while preparing the capture attempt.
        await client.query("BEGIN");

        const paymentResult = await client.query(
            `SELECT id, paypal_order_id, paypal_capture_id,
                    amount, currency, status
             FROM payments
             WHERE id = $1 AND merchant_id = $2
             FOR UPDATE`,
            [id, merchantId]
        );

        if (paymentResult.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = paymentResult.rows[0];

        // Prevent duplicate capture of completed payments.
        if (payment.status === "completed" && payment.paypal_capture_id) {
            await client.query("ROLLBACK");

            return res.status(200).json({
                success: true,
                message: "Payment already captured",
                payment
            });
        }

        if (!payment.paypal_order_id) {
            await client.query("ROLLBACK");

            return res.status(400).json({
                success: false,
                message: "PayPal order ID not found"
            });
        }

        // Prevent another capture while an earlier attempt is processing.
        const latestAttemptResult = await client.query(
            `SELECT status
             FROM payment_attempts
             WHERE payment_id = $1
             ORDER BY attempt_number DESC
             LIMIT 1`,
            [id]
        );

        if (
            latestAttemptResult.rows.length > 0 &&
            latestAttemptResult.rows[0].status === "processing"
        ) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "A capture attempt is already processing"
            });
        }

        // Verify authoritative PayPal order status.
        const paypalOrder = await getOrder(payment.paypal_order_id);

        if (paypalOrder.status === "COMPLETED") {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "Order is already completed at PayPal. Reconciliation is required."
            });
        }

        if (paypalOrder.status !== "APPROVED") {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "Customer approval is required before capture",
                paypalStatus: paypalOrder.status
            });
        }

        // Assign the next attempt number.
        const attemptNumberResult = await client.query(
            `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
             FROM payment_attempts
             WHERE payment_id = $1`,
            [id]
        );

        const attemptNumber = Number(
            attemptNumberResult.rows[0].next_attempt
        );

        // Create a capture attempt before calling PayPal.
        const attemptResult = await client.query(
            `INSERT INTO payment_attempts (
                payment_id,
                attempt_number,
                status,
                attempted_at
            )
            VALUES ($1, $2, $3, NOW())
            RETURNING id, attempt_number`,
            [id, attemptNumber, "processing"]
        );

        attemptId = attemptResult.rows[0].id;

        await client.query("COMMIT");

        // Stable idempotency key for this local payment.
        const requestId = `recoverai-capture-${payment.id}`;

        // Send capture request to PayPal.
        const captureResult = await captureOrder(
            payment.paypal_order_id,
            requestId
        );

        // Handle a capture that PayPal has not confirmed as completed.
        
// Handle a capture that PayPal has not confirmed as completed.
if (
    captureResult.status !== "COMPLETED" ||
    captureResult.captureStatus !== "COMPLETED" ||
    !captureResult.captureId
) {
    const definitiveCaptureFailure =
        captureResult.captureStatus === "DECLINED";

    const attemptStatus = definitiveCaptureFailure
        ? "failed"
        : "pending";

    const failureCode =
        captureResult.failureCode ||
        captureResult.details?.[0]?.issue ||
        captureResult.captureStatus ||
        captureResult.status ||
        "CAPTURE_OUTCOME_UNCONFIRMED";

    const failureMessage =
        captureResult.failureMessage ||
        captureResult.details?.[0]?.description ||
        "PayPal has not confirmed a completed capture. Reconciliation may be required.";

    await client.query("BEGIN");

    await client.query(
        `UPDATE payment_attempts
         SET status = $1,
             failure_code = $2,
             failure_message = $3
         WHERE id = $4`,
        [
            attemptStatus,
            failureCode,
            failureMessage,
            attemptId
        ]
    );

    if (definitiveCaptureFailure) {
        await client.query(
            `UPDATE payments
             SET status = 'failed',
                 updated_at = NOW()
             WHERE id = $1
               AND merchant_id = $2
               AND status NOT IN (
                   'completed',
                   'refunded',
                   'cancelled'
               )`,
            [id, merchantId]
        );
    }

    await client.query("COMMIT");

    return res.status(409).json({
        success: false,
        message: failureMessage,
        attemptNumber,
        attemptStatus
    });
}


        // PayPal confirmed capture. Validate amount and currency.
        const capturedAmount = captureResult.amount;

        const amountMatches =
            capturedAmount &&
            Number(capturedAmount.value) === Number(payment.amount) &&
            capturedAmount.currency_code === payment.currency;

        await client.query("BEGIN");

        if (!amountMatches) {
            await client.query(
                `UPDATE payment_attempts
                 SET status = 'completed',
                     failure_message = $1
                 WHERE id = $2`,
                [
                    "PayPal capture completed, but amount or currency does not match. Reconciliation required.",
                    attemptId
                ]
            );

            await client.query(
                `UPDATE payments
                 SET status = 'requires_action',
                     paypal_capture_id = $1,
                     updated_at = NOW()
                 WHERE id = $2
                   AND merchant_id = $3`,
                [captureResult.captureId, id, merchantId]
            );

            await client.query("COMMIT");

            return res.status(409).json({
                success: false,
                message: "Captured amount or currency does not match the local payment. Reconciliation required.",
                captureId: captureResult.captureId
            });
        }

        // Record successful attempt and update payment.
        await client.query(
            `UPDATE payment_attempts
             SET status = 'completed',
                 failure_code = NULL,
                 failure_message = NULL
             WHERE id = $1`,
            [attemptId]
        );

        const updateResult = await client.query(
            `UPDATE payments
             SET status = 'completed',
                 paypal_capture_id = $1,
                 updated_at = NOW()
             WHERE id = $2
               AND merchant_id = $3
               AND status <> 'completed'
             RETURNING id, paypal_order_id, paypal_capture_id,
                       amount, currency, status`,
            [captureResult.captureId, id, merchantId]
        );

        if (updateResult.rows.length === 0) {
            throw new Error(
                "Payment state changed during capture. Reconciliation required."
            );
        }

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: "PayPal payment captured successfully",
            payment: updateResult.rows[0],
            attempt: {
                id: attemptId,
                attemptNumber,
                status: "completed"
            },
            paypal: captureResult
        });




} catch (error) {
    console.error("PayPal capture error:", error);

    if (client) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error(
                "Capture rollback error:",
                rollbackError.message
            );
        }
    }

    if (attemptId && client) {
        const paypalError = error.paypalError || null;
        const detail = paypalError?.details?.[0] || {};

        const definitiveFailureIssues = [
            "INSTRUMENT_DECLINED"
        ];

        const isDefinitiveFailure =
            Boolean(paypalError) &&
            definitiveFailureIssues.includes(detail.issue);

        const attemptStatus = isDefinitiveFailure
            ? "failed"
            : "pending";

        const failureCode =
            detail.issue ||
            error.code ||
            "PAYPAL_OUTCOME_UNCONFIRMED";

        const failureMessage =
            detail.description ||
            paypalError?.message ||
            error.message ||
            "Unable to determine PayPal capture outcome";

        try {
            await client.query("BEGIN");

            await client.query(
                `UPDATE payment_attempts
                 SET status = $1,
                     failure_code = $2,
                     failure_message = $3
                 WHERE id = $4`,
                [
                    attemptStatus,
                    failureCode,
                    failureMessage,
                    attemptId
                ]
            );

            if (isDefinitiveFailure && paymentId) {
                const failureCategory =
                    classifyPayPalFailure(detail.issue);

                await client.query(
                    `INSERT INTO failure_analysis (
                        payment_id,
                        attempt_id,
                        failure_category,
                        explanation,
                        confidence,
                        model_name,
                        created_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                    [
                        paymentId,
                        attemptId,
                        failureCategory,
                        failureMessage,
                        null,
                        "rule-based-v1"
                    ]
                );

                await client.query(
                    `UPDATE payments
                     SET status = 'failed',
                         updated_at = NOW()
                     WHERE id = $1
                       AND status NOT IN (
                           'completed',
                           'refunded',
                           'cancelled'
                       )`,
                    [paymentId]
                );
            }

            await client.query("COMMIT");

        } catch (recordError) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error(
                    "Failure recording rollback error:",
                    rollbackError.message
                );
            }

            console.error(
                "Unable to record capture outcome:",
                recordError.message
            );
        }
    }

    return res.status(500).json({
        success: false,
        message: "Unable to confirm PayPal capture outcome",
        outcome: "UNCONFIRMED"
    });
}



 finally {
    if (client) {
        client.release();
    }
  }

};

module.exports = {
    getPayments,
    getPaymentById,
    getPaymentAttempts,
    createPayPalOrder,
    checkPayPalOrder,
    capturePayPalPayment
};