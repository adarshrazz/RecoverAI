const PAYPAL_BASE_URL = process.env.PAYPAL_BASE_URL;
const crypto = require("crypto");

let cachedAccessToken = null;
let tokenExpiryTime = 0;

// Get PayPal OAuth access token
const getAccessToken = async () => {
    if (cachedAccessToken && Date.now() < tokenExpiryTime) {
        return cachedAccessToken;
    }

    const clientId = process.env.PAYPAL_CLIENT_ID;
    const clientSecret = process.env.PAYPAL_CLIENT_SECRET;

    if (!clientId || !clientSecret || !PAYPAL_BASE_URL) {
        throw new Error("PayPal environment variables are missing");
    }

    const credentials = Buffer
        .from(`${clientId}:${clientSecret}`)
        .toString("base64");

    const response = await fetch(
        `${PAYPAL_BASE_URL}/v1/oauth2/token`,
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${credentials}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: "grant_type=client_credentials"
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            data.error_description || "PayPal authentication failed"
        );
    }

    cachedAccessToken = data.access_token;

    // Refresh token one minute before expiry
    tokenExpiryTime = Date.now() +
        (data.expires_in - 60) * 1000;

    return cachedAccessToken;
};

// Create PayPal order
const createOrder = async ({
    amount,
    currency = "USD",
    description = "RecoverAI Sandbox Payment",
    returnUrl,
    cancelUrl,
    requestId
}) => {
    const accessToken = await getAccessToken();

    const response = await fetch(
        `${PAYPAL_BASE_URL}/v2/checkout/orders`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                "PayPal-Request-Id": requestId || crypto.randomUUID()
            },
            body: JSON.stringify({
                intent: "CAPTURE",
                purchase_units: [
                    {
                        description,
                        amount: {
                            currency_code: currency,
                            value: Number(amount).toFixed(2)
                        }
                    }
                ],
                payment_source: undefined,
                application_context: {
                    return_url: returnUrl,
                    cancel_url: cancelUrl,
                    user_action: "PAY_NOW"
                }
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            data.message || "Unable to create PayPal order"
        );
    }

    const approvalLink = data.links?.find(
        link => link.rel === "approve"
    );

    if (!approvalLink) {
        throw new Error("PayPal approval URL was not returned");
    }

    return {
        orderId: data.id,
        status: data.status,
        approvalUrl: approvalLink.href
    };
};


// GET PAYPAL ORDER DETAILS
const getOrder = async (orderId) => {
    const accessToken = await getAccessToken();

    const response = await fetch(
        `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}`,
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            data.message || "Unable to retrieve PayPal order"
        );
    }

    return {
    orderId: data.id,
    status: data.status,
    intent: data.intent,
    payer: data.payer || null,
    paymentSource: data.payment_source || null,
    purchaseUnits: data.purchase_units
    };
};


// CAPTURE PAYPAL ORDER
const captureOrder = async (orderId, requestId) => {
    const accessToken = await getAccessToken();

    const response = await fetch(
        `${PAYPAL_BASE_URL}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
                // "PayPal-Request-Id": crypto.randomUUID()
                "PayPal-Request-Id": requestId || crypto.randomUUID()
            }
        }
    );

    const data = await response.json();

    if (!response.ok) {
    const error = new Error(
        data.message || "Unable to capture PayPal order"
    );

    error.code =
        data.details?.[0]?.issue ||
        data.name ||
        `PAYPAL_HTTP_${response.status}`;

    error.paypalError = {
        name: data.name || null,
        message: data.message || null,
        details: data.details || [],
        debugId: data.debug_id || null,
        httpStatus: response.status
    };

    throw error;
}

    const capture = data.purchase_units?.[0]
        ?.payments?.captures?.[0];

    return {
        orderId: data.id,
        status: data.status,
        captureId: capture?.id || null,
        captureStatus: capture?.status || null,
        amount: capture?.amount || null
    };
};


// VERIFY PAYPAL WEBHOOK SIGNATURE
const verifyWebhookSignature = async (headers, webhookEvent) => {
    const accessToken = await getAccessToken();

    const webhookId = process.env.PAYPAL_WEBHOOK_ID;

    if (!webhookId) {
        throw new Error("PAYPAL_WEBHOOK_ID is missing");
    }

    const response = await fetch(
        `${PAYPAL_BASE_URL}/v1/notifications/verify-webhook-signature`,
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                auth_algo: headers.authAlgo,
                cert_url: headers.certUrl,
                transmission_id: headers.transmissionId,
                transmission_sig: headers.transmissionSig,
                transmission_time: headers.transmissionTime,
                webhook_id: webhookId,
                webhook_event: webhookEvent
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {
        throw new Error(
            data.message || "PayPal signature verification failed"
        );
    }

    return data.verification_status === "SUCCESS";
};


module.exports = {
    getAccessToken,
    createOrder,
    getOrder,
    captureOrder,
    verifyWebhookSignature
};