const pool = require("../config/database");

const {
    generateRecoveryRecommendation
} = require("../services/recoveryService");

const {
    createOrder,
    getOrder,
    captureOrder
} = require("../services/paypalService");


// Generate a recovery recommendation for a payment
const createRecoveryRecommendation = async (req, res) => {
    try {
        const { id } = req.params;
        const merchantId = req.user.userId;

        // Validate payment ID
        if (!/^\d+$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment ID"
            });
        }

        const result = await generateRecoveryRecommendation(
            Number(id),
            merchantId
        );

        return res.status(200).json({
            success: true,
            message: result.created
                ? "Recovery recommendation generated successfully"
                : result.message,
            data: result
        });

    } catch (error) {
        console.error(
            "Recovery recommendation error:",
            error.message
        );

        if (
            error.message ===
            "No failure analysis found for this payment"
        ) {
            return res.status(404).json({
                success: false,
                message: error.message
            });
        }

        if (
            error.message ===
            "Recovery recommendation is allowed only for failed payments"
        ) {
            return res.status(409).json({
                success: false,
                message: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: "Unable to generate recovery recommendation"
        });
    }
};


// Get recovery recommendations for logged-in merchant
const getRecoveryRecommendations = async (req, res) => {
    try {
        const merchantId = req.user.userId;
        const { status } = req.query;

        
const result = await pool.query(
    `SELECT
        rr.*,
        fa.failure_category,
        p.amount,
        p.currency,
        p.status AS payment_status,
        GREATEST(
            0,
            FLOOR(
                EXTRACT(EPOCH FROM (NOW() - p.created_at)) / 3600
            )
        )::INTEGER AS payment_age_hours
     FROM recovery_recommendations rr
     JOIN payments p
        ON p.id = rr.payment_id
     LEFT JOIN failure_analysis fa
        ON fa.id = rr.analysis_id
     WHERE p.merchant_id = $1
       AND ($2::varchar IS NULL OR rr.status = $2)
     ORDER BY
        rr.priority_score DESC NULLS LAST,
        rr.created_at DESC`,
    [merchantId, status || null]
);


        return res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error(
            "Get recovery recommendations error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve recovery recommendations"
        });
    }
};


const createRecoveryAction = async (req, res) => {
    const client = await pool.connect();

    try {
        const { recommendationId } = req.params;
        const merchantId = req.user.userId;

        if (!/^\d+$/.test(recommendationId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid recommendation ID"
            });
        }

        await client.query("BEGIN");

        const result = await client.query(
            `SELECT
                rr.id,
                rr.payment_id,
                rr.action_type,
                rr.status AS recommendation_status,
                p.status AS payment_status
             FROM recovery_recommendations rr
             JOIN payments p ON p.id = rr.payment_id
             WHERE rr.id = $1
             AND p.merchant_id = $2
             FOR UPDATE OF rr, p`,
            [recommendationId, merchantId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");

            return res.status(404).json({
                success: false,
                message: "Recommendation not found"
            });
        }

        const recommendation = result.rows[0];

        if (recommendation.recommendation_status !== "active") {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "Recommendation is not active"
            });
        }

        if (recommendation.payment_status !== "failed") {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "Payment is not eligible for recovery"
            });
        }

        const existing = await client.query(
            `SELECT id
             FROM recovery_actions
             WHERE recommendation_id = $1
             AND status NOT IN ('cancelled', 'failed')
             LIMIT 1`,
            [recommendationId]
        );

        if (existing.rows.length > 0) {
            await client.query("ROLLBACK");

            return res.status(409).json({
                success: false,
                message: "A recovery action already exists for this recommendation"
            });
        }

        const inserted = await client.query(
            `INSERT INTO recovery_actions (
                payment_id,
                recommendation_id,
                initiated_by,
                action_type,
                status,
                created_at
             )
             VALUES ($1, $2, $3, $4, 'initiated', NOW())
             RETURNING *`,
            [
                recommendation.payment_id,
                recommendation.id,
                merchantId,
                recommendation.action_type
            ]
        );
        

            // Mark recommendation as accepted
            await client.query(
            `UPDATE recovery_recommendations
            SET status = 'action_created'
            WHERE id = $1`,
             [recommendation.id]
         );


        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Recovery action created successfully",
            data: inserted.rows[0]
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Rollback error:", rollbackError.message);
        }

        console.error("Create recovery action error:", error.message);
        if (error.code === "23505") {
    return res.status(409).json({
        success: false,
        message: "An active recovery action already exists for this recommendation"
    });
}

        return res.status(500).json({
            success: false,
            message: "Unable to create recovery action"
        });

    } finally {
        client.release();
    }
};


const updateRecoveryActionStatus = async (req, res) => {
    const { actionId } = req.params;
    const { status } = req.body || {};
    const merchantId = req.user.userId;

    const allowedStatuses = [
        "in_progress",
        "completed",
        "failed",
        "cancelled"
    ];

    if (!/^\d+$/.test(actionId)) {
        return res.status(400).json({
            success: false,
            message: "Invalid recovery action ID"
        });
    }

    if (!allowedStatuses.includes(status)) {
        return res.status(400).json({
            success: false,
            message: "Invalid recovery action status"
        });
    }

    let client;

    try {
        client = await pool.connect();
        await client.query("BEGIN");

        const result = await client.query(
            `SELECT
                ra.id,
                ra.status,
                ra.recommendation_id,
                p.status AS payment_status
             FROM recovery_actions ra
             JOIN payments p ON p.id = ra.payment_id
             WHERE ra.id = $1
               AND p.merchant_id = $2
             FOR UPDATE OF ra, p`,
            [actionId, merchantId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Recovery action not found"
            });
        }

        const action = result.rows[0];

        const validTransition =
            (action.status === "initiated" &&
                allowedStatuses.includes(status)) ||
            (action.status === "in_progress" &&
                ["completed", "failed", "cancelled"].includes(status));

        if (!validTransition) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "Invalid recovery action status transition"
            });
        }

        // Completing an action does not prove payment recovery.
        // PayPal must independently confirm payment success.
        const updated = await client.query(
            `UPDATE recovery_actions
             SET status = $1,
                 completed_at = CASE
                     WHEN $1 = 'completed' THEN NOW()
                     ELSE NULL
                 END
             WHERE id = $2
             RETURNING *`,
            [status, actionId]
        );

        if (action.recommendation_id) {
            const recommendationStatus =
                status === "completed"
                    ? "completed"
                    : ["failed", "cancelled"].includes(status)
                        ? "active"
                        : "action_created";

            await client.query(
                `UPDATE recovery_recommendations
                 SET status = $1
                 WHERE id = $2
                   AND payment_id = (
                       SELECT payment_id
                       FROM recovery_actions
                       WHERE id = $3
                   )`,
                [
                    recommendationStatus,
                    action.recommendation_id,
                    actionId
                ]
            );
        }

        await client.query("COMMIT");

        return res.status(200).json({
            success: true,
            message: "Recovery action status updated successfully",
            data: updated.rows[0]
        });


    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error(
                    "Recovery rollback error:",
                    rollbackError.message
                );
            }
        }

        console.error(
            "Update recovery action error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to update recovery action"
        });

    } finally {
        if (client) {
            client.release();
        }
    }
};




const getRecoveryActions = async (req, res) => {
    try {
        const merchantId = req.user.userId;

        const result = await pool.query(
            `SELECT
                ra.*,
                p.amount,
                p.currency,
                p.status AS payment_status,
                rr.priority,
                rr.rationale
             FROM recovery_actions ra
             JOIN payments p
                ON p.id = ra.payment_id
             LEFT JOIN recovery_recommendations rr
                ON rr.id = ra.recommendation_id
             WHERE p.merchant_id = $1
             ORDER BY ra.created_at DESC`,
            [merchantId]
        );

        return res.status(200).json({
            success: true,
            count: result.rows.length,
            data: result.rows
        });

    } catch (error) {
        console.error(
            "Get recovery actions error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to retrieve recovery actions"
        });
    }
};




const updateRecoveryActionDetails = async (req, res) => {
    try {
        const { actionId } = req.params;
        const { checkoutUrl, externalReference } = req.body || {};
        const merchantId = req.user.userId;

        if (!/^\d+$/.test(actionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid recovery action ID"
            });
        }

        const validateText = (value, maxLength) => {
            if (value === undefined) return true;

            return (
                typeof value === "string" &&
                value.trim().length > 0 &&
                value.trim().length <= maxLength
            );
        };

        if (!validateText(checkoutUrl, 2048)) {
            return res.status(400).json({
                success: false,
                message: "Invalid checkout URL"
            });
        }

        if (!validateText(externalReference, 255)) {
            return res.status(400).json({
                success: false,
                message: "Invalid external reference"
            });
        }

        if (
            checkoutUrl === undefined &&
            externalReference === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "Provide a checkout URL or external reference"
            });
        }

        if (checkoutUrl !== undefined) {
            let parsedUrl;

            try {
                parsedUrl = new URL(checkoutUrl.trim());
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "Invalid checkout URL format"
                });
            }

            if (parsedUrl.protocol !== "https:") {
                return res.status(400).json({
                    success: false,
                    message: "Checkout URL must use HTTPS"
                });
            }
        }

        const result = await pool.query(
            `UPDATE recovery_actions ra
             SET checkout_url = COALESCE($1, ra.checkout_url),
                 external_reference = COALESCE($2, ra.external_reference)
             FROM payments p
             WHERE ra.id = $3
               AND ra.payment_id = p.id
               AND p.merchant_id = $4
               AND ra.status IN ('initiated', 'in_progress')
             RETURNING ra.*`,
            [
                checkoutUrl === undefined ? null : checkoutUrl.trim(),
                externalReference === undefined
                    ? null
                    : externalReference.trim(),
                actionId,
                merchantId
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Recovery action not found or cannot be updated"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Recovery action details updated successfully",
            data: result.rows[0]
        });

    } catch (error) {
        console.error(
            "Update recovery action details error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to update recovery action details"
        });
    }
};




// CREATE PAYPAL RECOVERY CHECKOUT
const createRecoveryCheckout = async (req, res) => {
    const client = await pool.connect();

    try {
        const { actionId } = req.params;
        const merchantId = req.user.userId;

        if (!/^\d+$/.test(actionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid recovery action ID"
            });
        }

        await client.query("BEGIN");

        // Lock the recovery action and its original payment.
        const result = await client.query(
            `SELECT
                ra.id,
                ra.status AS action_status,
                ra.paypal_order_id AS recovery_paypal_order_id,
                ra.checkout_url,
                p.id AS payment_id,
                p.status AS payment_status,
                p.amount,
                p.currency,
                p.paypal_order_id AS original_paypal_order_id,
                p.paypal_capture_id
             FROM recovery_actions ra
             JOIN payments p ON p.id = ra.payment_id
             WHERE ra.id = $1
               AND p.merchant_id = $2
             FOR UPDATE OF ra, p`,
            [actionId, merchantId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Recovery action not found"
            });
        }

        const action = result.rows[0];

        // Return the existing checkout instead of creating another order.
        if (action.recovery_paypal_order_id && action.checkout_url) {
            await client.query("COMMIT");

            return res.status(200).json({
                success: true,
                message: "Existing recovery checkout retrieved",
                data: {
                    actionId: action.id,
                    paypalOrderId: action.recovery_paypal_order_id,
                    approvalUrl: action.checkout_url
                }
            });
        }

        if (!["initiated", "in_progress"].includes(action.action_status)) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "Recovery action is not eligible for checkout"
            });
        }

        if (
            action.payment_status !== "failed" ||
            action.paypal_capture_id ||
            !action.original_paypal_order_id
        ) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "Original payment is not eligible for recovery"
            });
        }

        // An uncertain capture must be reconciled before another checkout.
        const attemptResult = await client.query(
            `SELECT status
             FROM payment_attempts
             WHERE payment_id = $1
             ORDER BY attempt_number DESC
             LIMIT 1`,
            [action.payment_id]
        );

        if (
            attemptResult.rows.length > 0 &&
            ["pending", "processing"].includes(attemptResult.rows[0].status)
        ) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "The previous payment outcome is uncertain. Reconciliation is required."
            });
        }


// Verify the original PayPal order before creating a new checkout.
// Seeded DEMO orders are placeholders, not real PayPal resources.
const isSeededDemoOrder =
    String(action.original_paypal_order_id).startsWith("DEMO-");

if (!isSeededDemoOrder) {
    const originalOrder = await getOrder(
        action.original_paypal_order_id
    );

    // Only a confirmed VOIDED order can be replaced.
    if (originalOrder.status !== "VOIDED") {
        await client.query("ROLLBACK");

        return res.status(409).json({
            success: false,
            message: "The original PayPal order is not confirmed voided. A new checkout is blocked.",
            originalPayPalStatus: originalOrder.status
        });
    }
} else {
    console.log(
        "Seeded demo payment detected. Using Sandbox recovery checkout."
    );
}


        // Stable idempotency key: retries for this action reuse the same key.
        const paypalOrder = await createOrder({
            amount: action.amount,
            currency: action.currency,
            description: `RecoverAI recovery for payment ${action.payment_id}`,
            returnUrl:
                `http://127.0.0.1:5500/frontend/index.html?recovery=success&actionId=${action.id}`,
            cancelUrl:
                `http://127.0.0.1:5500/frontend/index.html?recovery=cancel&actionId=${action.id}`,
            requestId: `recoverai-recovery-${action.id}`
        });

        // Save the new PayPal order and its approval URL.
        const updated = await client.query(
            `UPDATE recovery_actions
             SET paypal_order_id = $1,
                 checkout_url = $2
             WHERE id = $3
             RETURNING id, paypal_order_id, checkout_url, status`,
            [
                paypalOrder.orderId,
                paypalOrder.approvalUrl,
                action.id
            ]
        );

        await client.query("COMMIT");

        return res.status(201).json({
            success: true,
            message: "Recovery checkout created successfully",
            data: updated.rows[0]
        });

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Recovery checkout rollback error:", rollbackError.message);
        }

        console.error("Create recovery checkout error:", error.message);

        return res.status(500).json({
            success: false,
            message: "Unable to create recovery checkout"
        });

    } finally {
        client.release();
    }
};



// CAPTURE PAYPAL RECOVERY PAYMENT
const captureRecoveryPayment = async (req, res) => {
    let client;
    let attemptId;
    let paymentId;
    let merchantId;
    let actionId;

    try {
        actionId = req.params.actionId;
        merchantId = req.user.userId;

        if (!/^\d+$/.test(actionId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid recovery action ID"
            });
        }

        client = await pool.connect();
        await client.query("BEGIN");

        const result = await client.query(
            `SELECT
                ra.id,
                ra.status AS action_status,
                ra.paypal_order_id,
                ra.paypal_capture_id,
                ra.recommendation_id,
                p.id AS payment_id,
                p.status AS payment_status,
                p.amount,
                p.currency,
                p.paypal_capture_id AS original_capture_id
             FROM recovery_actions ra
             JOIN payments p ON p.id = ra.payment_id
             WHERE ra.id = $1
               AND p.merchant_id = $2
             FOR UPDATE OF ra, p`,
            [actionId, merchantId]
        );

        if (result.rows.length === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({
                success: false,
                message: "Recovery action not found"
            });
        }

        const action = result.rows[0];
        paymentId = action.payment_id;

        // Idempotent response if recovery is already recorded.
        if (action.paypal_capture_id) {
            await client.query("COMMIT");
            return res.status(200).json({
                success: true,
                message: "Recovery payment was already captured",
                captureId: action.paypal_capture_id
            });
        }

        if (
            !["initiated", "in_progress"].includes(action.action_status) ||
            action.payment_status !== "failed" ||
            action.original_capture_id ||
            !action.paypal_order_id
        ) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "Recovery action or original payment is not eligible for capture"
            });
        }

        // Never retry an earlier capture with an uncertain outcome.
        const previousAttempt = await client.query(
            `SELECT status
             FROM payment_attempts
             WHERE payment_id = $1
             ORDER BY attempt_number DESC
             LIMIT 1`,
            [paymentId]
        );

        if (
            previousAttempt.rows.length > 0 &&
            ["pending", "processing"].includes(previousAttempt.rows[0].status)
        ) {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "A previous capture outcome is uncertain. Reconciliation is required."
            });
        }

        // Confirm that PayPal still considers this order approved.
        const paypalOrder = await getOrder(action.paypal_order_id);

        if (paypalOrder.status !== "APPROVED") {
            await client.query("ROLLBACK");
            return res.status(409).json({
                success: false,
                message: "PayPal order is not approved for capture",
                paypalStatus: paypalOrder.status
            });
        }

        const attemptNumberResult = await client.query(
            `SELECT COALESCE(MAX(attempt_number), 0) + 1 AS next_attempt
             FROM payment_attempts
             WHERE payment_id = $1`,
            [paymentId]
        );

        const attemptNumber = Number(
            attemptNumberResult.rows[0].next_attempt
        );

        const attemptResult = await client.query(
            `INSERT INTO payment_attempts (
                payment_id,
                attempt_number,
                status,
                attempted_at
             )
             VALUES ($1, $2, 'processing', NOW())
             RETURNING id`,
            [paymentId, attemptNumber]
        );

        attemptId = attemptResult.rows[0].id;

        await client.query("COMMIT");

        // Stable idempotency key for this recovery action.
        const captureResult = await captureOrder(
            action.paypal_order_id,
            `recoverai-recovery-capture-${action.id}`
        );

        if (
            captureResult.status !== "COMPLETED" ||
            captureResult.captureStatus !== "COMPLETED" ||
            !captureResult.captureId
        ) {
            await client.query("BEGIN");

            await client.query(
                `UPDATE payment_attempts
                 SET status = 'pending',
                     failure_code = $1,
                     failure_message = $2
                 WHERE id = $3`,
                [
                    captureResult.captureStatus || "CAPTURE_UNCONFIRMED",
                    "PayPal has not confirmed a completed recovery capture.",
                    attemptId
                ]
            );

            await client.query(
                `UPDATE recovery_actions
                 SET status = 'in_progress'
                 WHERE id = $1`,
                [actionId]
            );

            await client.query("COMMIT");

            return res.status(409).json({
                success: false,
                message: "Recovery capture is not confirmed. Reconciliation is required.",
                outcome: "UNCONFIRMED"
            });
        }

        const capturedAmount = captureResult.amount;

        const amountMatches =
            capturedAmount &&
            Number(capturedAmount.value) === Number(action.amount) &&
            capturedAmount.currency_code === action.currency;

        await client.query("BEGIN");

        await client.query(
            `UPDATE payment_attempts
             SET status = 'completed',
                 failure_code = NULL,
                 failure_message = $1
             WHERE id = $2`,
            [
                amountMatches
                    ? null
                    : "PayPal capture completed, but amount or currency requires reconciliation.",
                attemptId
            ]
        );

        await client.query(
            `UPDATE recovery_actions
             SET paypal_capture_id = $1,
                 external_reference = $1,
                 status = 'completed',
                 completed_at = NOW()
             WHERE id = $2`,
            [captureResult.captureId, actionId]
        );

        // Record the verified capture, but flag any amount mismatch.
        await client.query(
            `UPDATE payments
             SET paypal_capture_id = $1,
                 status = $2,
                 updated_at = NOW()
             WHERE id = $3
               AND merchant_id = $4`,
            [
                captureResult.captureId,
                amountMatches ? "completed" : "requires_action",
                paymentId,
                merchantId
            ]
        );

        if (action.recommendation_id) {
            await client.query(
                `UPDATE recovery_recommendations
                 SET status = 'completed'
                 WHERE id = $1`,
                [action.recommendation_id]
            );
        }

        await client.query("COMMIT");

        if (!amountMatches) {
            return res.status(409).json({
                success: false,
                message: "PayPal captured the payment, but amount or currency does not match. Reconciliation is required.",
                captureId: captureResult.captureId
            });
        }

        return res.status(200).json({
            success: true,
            message: "Recovery payment captured successfully",
            captureId: captureResult.captureId,
            paymentStatus: "completed"
        });

    } catch (error) {
        if (client) {
            try {
                await client.query("ROLLBACK");
            } catch (rollbackError) {
                console.error("Recovery capture rollback error:", rollbackError.message);
            }
        }

        console.error("Recovery capture error:", error.message);

        if (client && attemptId) {
            const definitiveFailure =
                error.paypalError?.details?.[0]?.issue === "INSTRUMENT_DECLINED";

            try {
                await client.query("BEGIN");

                await client.query(
                    `UPDATE payment_attempts
                     SET status = $1,
                         failure_code = $2,
                         failure_message = $3
                     WHERE id = $4`,
                    [
                        definitiveFailure ? "failed" : "pending",
                        error.paypalError?.details?.[0]?.issue ||
                            error.code ||
                            "PAYPAL_OUTCOME_UNCONFIRMED",
                        error.message,
                        attemptId
                    ]
                );

                if (definitiveFailure) {
                    await client.query(
                        `UPDATE recovery_actions
                         SET status = 'failed'
                         WHERE id = $1`,
                        [actionId]
                    );

                    await client.query(
                        `UPDATE recovery_recommendations
                         SET status = 'active'
                         WHERE id = (
                             SELECT recommendation_id
                             FROM recovery_actions
                             WHERE id = $1
                         )`,
                        [actionId]
                    );
                } else {
                    await client.query(
                        `UPDATE recovery_actions
                         SET status = 'in_progress'
                         WHERE id = $1`,
                        [actionId]
                    );
                }

                await client.query("COMMIT");
            } catch (recordError) {
                await client.query("ROLLBACK").catch(() => {});
                console.error("Unable to record recovery capture outcome:", recordError.message);
            }
        }

        return res.status(409).json({
            success: false,
            message: "Unable to confirm recovery capture. Reconciliation may be required.",
            outcome: "UNCONFIRMED"
        });

    } finally {
        if (client) {
            client.release();
        }
    }
};



// Parse structured JSON returned by Gemini, including optional Markdown fences.
const parseAIJson = (responseText) => {
    if (typeof responseText !== "string") {
        throw new Error("AI returned an invalid response");
    }

    const cleaned = responseText
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");

    return JSON.parse(cleaned);
};


// Generate an AI explanation from verified payment and failure data.
const analyzePaymentWithAI = async (req, res) => {
    try {
        const { id } = req.params;
        const merchantId = req.user.userId;

        if (!/^\d+$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment ID"
            });
        }

        const result = await pool.query(
            `SELECT
                p.id,
                p.amount,
                p.currency,
                p.status,
                p.description,
                p.paypal_order_id,
                p.created_at,
                c.name AS customer_name,
                fa.failure_category,
                fa.explanation AS recorded_failure_explanation,
                fa.confidence AS recorded_confidence,
                fa.model_name AS recorded_model,
                pa.failure_code,
                pa.failure_message,
                pa.attempt_number,
                pa.attempted_at
             FROM payments p
             LEFT JOIN customers c
                ON c.id = p.customer_id
               AND c.merchant_id = p.merchant_id
             LEFT JOIN LATERAL (
                SELECT *
                FROM failure_analysis
                WHERE payment_id = p.id
                ORDER BY created_at DESC
                LIMIT 1
             ) fa ON TRUE
             LEFT JOIN LATERAL (
                SELECT *
                FROM payment_attempts
                WHERE payment_id = p.id
                ORDER BY attempt_number DESC
                LIMIT 1
             ) pa ON TRUE
             WHERE p.id = $1
               AND p.merchant_id = $2`,
            [Number(id), merchantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = result.rows[0];

        if (payment.status !== "failed") {
            return res.status(409).json({
                success: false,
                message: "AI failure analysis is available only for failed payments"
            });
        }

        if (!payment.failure_category && !payment.failure_code && !payment.failure_message) {
            return res.status(409).json({
                success: false,
                message: "No recorded failure details are available for this payment"
            });
        }

        const { analyzePaymentFailure } = require("../services/aiService");
        const aiText = await analyzePaymentFailure(payment);
        const analysis = parseAIJson(aiText);

        return res.status(200).json({
            success: true,
            message: "AI payment analysis generated",
            data: {
                paymentId: Number(id),
                analysis,
                source: "recorded_payment_data"
            }
        });

    } catch (error) {
        console.error("AI payment analysis error:", error.message);

        if (error instanceof SyntaxError) {
            return res.status(502).json({
                success: false,
                message: "AI returned an invalid structured response"
            });
        }

        return res.status(502).json({
            success: false,
            message: "Unable to generate AI payment analysis"
        });
    }
};






// Draft a customer message using a merchant-owned payment and recommendation.
const generateAIRecoveryMessage = async (req, res) => {
    let timeoutId;

    try {
        const { id } = req.params;
        const merchantId = req.user.userId;

        if (!/^\d+$/.test(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment ID"
            });
        }

        const result = await pool.query(
            `SELECT
                p.id,
                p.amount,
                p.currency,
                p.status,
                p.description,
                c.name AS customer_name,
                c.email AS customer_email,
                rr.id AS recommendation_id,
                rr.action_type,
                rr.rationale,
                rr.priority,
                rr.priority_score
             FROM payments p
             LEFT JOIN customers c
                ON c.id = p.customer_id
               AND c.merchant_id = p.merchant_id
             LEFT JOIN LATERAL (
                SELECT *
                FROM recovery_recommendations
                WHERE payment_id = p.id
                  AND status IN ('active', 'action_created')
                ORDER BY priority_score DESC NULLS LAST, created_at DESC
                LIMIT 1
             ) rr ON TRUE
             WHERE p.id = $1
               AND p.merchant_id = $2`,
            [Number(id), merchantId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = result.rows[0];

        if (payment.status !== "failed") {
            return res.status(409).json({
                success: false,
                message: "Recovery messages can only be drafted for failed payments"
            });
        }

        if (!payment.recommendation_id) {
            return res.status(409).json({
                success: false,
                message: "Generate a recovery recommendation before drafting a customer message"
            });
        }

        const { generateRecoveryMessage } =
            require("../services/aiService");

        // Prevent a stalled Gemini request from keeping the API pending forever.
        const aiRequest = generateRecoveryMessage(
            {
                amount: payment.amount,
                currency: payment.currency,
                description: payment.description,
                customerName: payment.customer_name,
                customerEmail: payment.customer_email
            },
            {
                actionType: payment.action_type,
                rationale: payment.rationale,
                priority: payment.priority
            }
        );

        const timeout = new Promise((resolve, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error("GEMINI_REQUEST_TIMEOUT"));
            }, 45000);
        });

        const message = await Promise.race([
            aiRequest,
            timeout
        ]);

        return res.status(200).json({
            success: true,
            message: "Recovery message drafted successfully",
            data: {
                paymentId: Number(id),
                recommendationId: payment.recommendation_id,
                draft: message
            }
        });

    } catch (error) {
        console.error(
            "AI recovery message error:",
            error.message
        );

        if (error.message === "GEMINI_REQUEST_TIMEOUT") {
            return res.status(504).json({
                success: false,
                message: "Gemini took too long to respond. Please try again."
            });
        }

        return res.status(502).json({
            success: false,
            message: "Unable to generate recovery message"
        });

    } finally {
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
    }
};


module.exports = {
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
};