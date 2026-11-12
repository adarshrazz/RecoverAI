
const pool = require("../config/database");
const { verifyWebhookSignature } = require("../services/paypalService");

// Map supported PayPal events to RecoverAI payment statuses.
const getPaymentUpdate = (event) => {
    const eventType = event.event_type;
    const resource = event.resource || {};

    switch (eventType) {
        case "CHECKOUT.ORDER.APPROVED":
            return {
                status: "approved",
                orderId: resource.id || null,
                captureId: null
            };

        case "PAYMENT.CAPTURE.COMPLETED":
            return {
                status: "completed",
                orderId: resource.supplementary_data?.related_ids?.order_id || null,
                captureId: resource.id || null
            };

        case "PAYMENT.CAPTURE.DENIED":
            return {
                status: "failed",
                orderId: resource.supplementary_data?.related_ids?.order_id || null,
                captureId: resource.id || null
            };

        case "PAYMENT.CAPTURE.PENDING":
            return {
                status: "pending",
                orderId: resource.supplementary_data?.related_ids?.order_id || null,
                captureId: resource.id || null
            };

        case "PAYMENT.CAPTURE.REFUNDED":
            return {
                status: "refunded",
                orderId: resource.supplementary_data?.related_ids?.order_id || null,
                captureId:
                    resource.supplementary_data?.related_ids?.capture_id || null
            };

        default:
            return null;
    }
};

// RECEIVE, VERIFY, STORE, AND PROCESS PAYPAL WEBHOOK
const handlePayPalWebhook = async (req, res) => {
    let eventId = null;
    let verifiedEventStored = false;

    try {
        const event = req.body;

        // Validate incoming event.
        if (!event || !event.id || !event.event_type) {
            return res.status(400).json({
                success: false,
                message: "Invalid PayPal webhook event"
            });
        }

        eventId = event.id;

        // Extract PayPal transmission headers.
        const headers = {
            authAlgo: req.get("paypal-auth-algo"),
            certUrl: req.get("paypal-cert-url"),
            transmissionId: req.get("paypal-transmission-id"),
            transmissionSig: req.get("paypal-transmission-sig"),
            transmissionTime: req.get("paypal-transmission-time")
        };

        // Validate required signature headers.
        const missingHeaders = Object.entries(headers)
            .filter(([, value]) => !value)
            .map(([name]) => name);

        if (missingHeaders.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Missing PayPal signature headers",
                missingHeaders
            });
        }

        // Verify event authenticity with PayPal.
        const isVerified = await verifyWebhookSignature(headers, event);

        if (!isVerified) {
            return res.status(401).json({
                success: false,
                message: "PayPal webhook signature verification failed"
            });
        }

        const resourceId = event.resource?.id || null;

        // Store verified event. Unique constraint prevents duplicate event IDs.
        await pool.query(
            `INSERT INTO webhook_events (
                provider,
                provider_event_id,
                event_type,
                resource_id,
                payload,
                processing_status,
                received_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, NOW())
            ON CONFLICT (provider, provider_event_id) DO NOTHING
            RETURNING id`,
            [
                "paypal",
                event.id,
                event.event_type,
                resourceId,
                JSON.stringify(event),
                "received"
            ]
        );

        verifiedEventStored = true;

        // Start database transaction.
        const client = await pool.connect();

        try {
            await client.query("BEGIN");

            // Lock event row to prevent concurrent processing.
            const eventResult = await client.query(
                `SELECT id, processing_status
                 FROM webhook_events
                 WHERE provider = $1
                   AND provider_event_id = $2
                 FOR UPDATE`,
                ["paypal", event.id]
            );

            if (eventResult.rowCount === 0) {
                throw new Error("Verified webhook event not found");
            }

            const storedEvent = eventResult.rows[0];

            // Already processed event.
            if (storedEvent.processing_status === "processed") {
                await client.query("COMMIT");

                return res.status(200).json({
                    success: true,
                    message: "Duplicate webhook event already processed",
                    eventId: event.id
                });
            }

            const paymentUpdate = getPaymentUpdate(event);

            // Safely acknowledge unsupported event types.
            if (!paymentUpdate) {
                await client.query(
                    `UPDATE webhook_events
                     SET processing_status = 'processed',
                         processed_at = NOW(),
                         processing_error = NULL
                     WHERE id = $1`,
                    [storedEvent.id]
                );

                await client.query("COMMIT");

                return res.status(200).json({
                    success: true,
                    message: "Webhook verified; no payment synchronization required",
                    eventType: event.event_type
                });
            }

            if (!paymentUpdate.captureId && !paymentUpdate.orderId) {
                throw new Error(
                    "PayPal event does not contain a usable payment or order ID"
                );
            }

            // Match the local payment using PayPal capture or order ID.
            const paymentResult = await client.query(
                `UPDATE payments
                 SET status = CASE
                     WHEN $3 = 'refunded' THEN 'refunded'
                     WHEN status = 'refunded' THEN 'refunded'
                     WHEN $3 = 'completed' THEN 'completed'
                     WHEN status = 'completed' THEN 'completed'
                     WHEN status = 'failed'
                          AND $3 IN ('pending', 'approved') THEN 'failed'
                     ELSE $3
                 END,
                 updated_at = NOW()
                 WHERE (
                     ($1::varchar IS NOT NULL AND paypal_capture_id = $1)
                     OR
                     ($2::varchar IS NOT NULL AND paypal_order_id = $2)
                 )
                 RETURNING id, status`,
                [
                    paymentUpdate.captureId,
                    paymentUpdate.orderId,
                    paymentUpdate.status
                ]
            );

            if (paymentResult.rowCount === 0) {
                throw new Error(
                    `No RecoverAI payment matches PayPal resource ${resourceId || event.id}`
                );
            }

            // Mark webhook event as processed.
            await client.query(
                `UPDATE webhook_events
                 SET processing_status = 'processed',
                     processed_at = NOW(),
                     processing_error = NULL
                 WHERE id = $1`,
                [storedEvent.id]
            );

            await client.query("COMMIT");

            return res.status(200).json({
                success: true,
                message: "PayPal webhook verified and processed",
                eventId: event.id,
                eventType: event.event_type,
                updatedPayments: paymentResult.rows
            });

        } catch (processingError) {
            await client.query("ROLLBACK");
            throw processingError;

        } finally {
            client.release();
        }

    } catch (error) {
        console.error(
            "PayPal webhook processing error:",
            error.message
        );

        // Record processing failure so it can be investigated or retried.
        if (eventId && verifiedEventStored) {
            try {
                await pool.query(
                    `UPDATE webhook_events
                     SET processing_status = 'failed',
                         processing_error = $2
                     WHERE provider = 'paypal'
                       AND provider_event_id = $1
                       AND processing_status <> 'processed'`,
                    [eventId, error.message]
                );
            } catch (databaseError) {
                console.error(
                    "Unable to record webhook processing failure:",
                    databaseError.message
                );
            }
        }

        // HTTP 500 allows PayPal to retry delivery.
        return res.status(500).json({
            success: false,
            message: "Unable to process PayPal webhook"
        });
    }
};

module.exports = {
    handlePayPalWebhook
};
