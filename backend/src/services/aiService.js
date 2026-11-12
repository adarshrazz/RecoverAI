
const { GoogleGenAI } = require("@google/genai");

if (!process.env.GEMINI_API_KEY) {
    console.warn("Warning: GEMINI_API_KEY is not configured.");
}

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || ""
});

const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";

const MAX_ATTEMPTS = 2;
const REQUEST_TIMEOUT_MS = 15000;
const INITIAL_RETRY_DELAY_MS = 1000;

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableError(error) {
    const status = Number(
        error?.status ||
        error?.httpStatus ||
        error?.error?.code ||
        error?.code
    );

    const message = String(
        error?.message ||
        error?.error?.message ||
        ""
    ).toUpperCase();

    return (
        [429, 500, 502, 503, 504].includes(status) ||
        message.includes("UNAVAILABLE") ||
        message.includes("RESOURCE_EXHAUSTED") ||
        message.includes("TOO MANY REQUESTS") ||
        message.includes("HIGH DEMAND") ||
        message.includes("GEMINI_REQUEST_TIMEOUT")
    );
}

async function generateAIResponse(prompt) {
    if (!process.env.GEMINI_API_KEY) {
        throw new Error("Gemini API key is not configured.");
    }

    if (!prompt || typeof prompt !== "string") {
        throw new Error("A valid prompt is required.");
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        let timeoutId;

        try {
            const request = ai.models.generateContent({
                model: MODEL,
                contents: prompt
            });

            const timeout = new Promise((resolve, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error("GEMINI_REQUEST_TIMEOUT"));
                }, REQUEST_TIMEOUT_MS);
            });

            const response = await Promise.race([
                request,
                timeout
            ]);

            const text = response.text;

            if (!text || !text.trim()) {
                throw new Error("Gemini returned an empty response.");
            }

            return text.trim();

        } catch (error) {
            const shouldRetry =
                attempt < MAX_ATTEMPTS &&
                isRetryableError(error);

            if (!shouldRetry) {
                console.error(
                    "Gemini request failed:",
                    error.message
                );
                throw error;
            }

            const delay =
                INITIAL_RETRY_DELAY_MS * (2 ** (attempt - 1));

            console.warn(
                `Gemini temporary failure. Attempt ${attempt}/${MAX_ATTEMPTS}. Retrying in ${delay}ms.`
            );

            await wait(delay);

        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        }
    }

    throw new Error("Gemini request could not be completed.");
}


function generateFallbackPaymentAnalysis(payment) {
    const category = String(
        payment.failure_category || "UNKNOWN_FAILURE"
    ).toUpperCase();

    const failureCode = payment.failure_code || "Not recorded";
    const failureMessage = payment.failure_message || "No failure message recorded";

    const rules = {
        CARD_DECLINED: {
            cause: "The payment was declined. The exact reason was not provided in the recorded data.",
            action: "Ask the customer to verify their payment details or use another payment method."
        },
        INSUFFICIENT_FUNDS: {
            cause: "The recorded failure category indicates insufficient funds.",
            action: "Politely ask the customer to check their available balance or use another payment method."
        },
        AUTHENTICATION_REQUIRED: {
            cause: "The payment requires additional customer authentication.",
            action: "Ask the customer to complete the required authentication through the payment provider."
        },
        PAYMENT_METHOD_EXPIRED: {
            cause: "The recorded payment method has expired.",
            action: "Ask the customer to update their payment method."
        },
        UNKNOWN_FAILURE: {
            cause: "The available records do not establish the exact reason for the payment failure.",
            action: "Review the recorded failure details before contacting the customer."
        }
    };

    const rule = rules[category] || rules.UNKNOWN_FAILURE;

    const amount = payment.amount != null
        ? `${payment.currency || ""} ${payment.amount}`.trim()
        : "the recorded amount";

    const explanation =
        `The payment of ${amount} failed. ` +
        `Recorded category: ${category}. ` +
        `Failure code: ${failureCode}. ` +
        `Recorded message: ${failureMessage}.`;

    return JSON.stringify({
        failureExplanation: explanation,
        possibleCause: rule.cause,
        recommendedAction: rule.action,
        customerMessage:
            "Hello, your recent payment could not be completed. " +
            "Please review your payment details or contact us if you need assistance.",
        confidence: category === "UNKNOWN_FAILURE" ? "low" : "medium"
    });
}

async function analyzePaymentFailure(payment) {
    try {
        const prompt = `
You are RecoverAI, an AI payment failure analyst.

Analyze the following recorded payment information:

${JSON.stringify(payment, null, 2)}

Return ONLY valid JSON with these exact fields:

{
  "failureExplanation": "Explain what happened using the recorded data.",
  "possibleCause": "Give a possible cause and clearly identify uncertainty.",
  "recommendedAction": "Suggest a safe next step for the merchant.",
  "customerMessage": "Write a short, polite message for the customer.",
  "confidence": "high, medium, or low"
}

Rules:
- Never invent missing payment information.
- Distinguish recorded facts from possible causes.
- Do not claim a payment succeeded.
- Do not recommend an unauthorized charge or retry.
- Do not include sensitive payment information.
- Keep the response valid JSON without Markdown.
`;

        const response = await generateAIResponse(prompt);

        return response;

    } catch (error) {
        console.warn(
            "Gemini payment analysis unavailable. Using rule-based fallback:",
            error.message
        );

        return generateFallbackPaymentAnalysis(payment);
    }
}

function generateFallbackRecoveryMessage(payment, recommendation) {
    const customerName = payment.customerName || "Customer";
    const amount = payment.amount || "your payment";
    const currency = payment.currency || "";
    const action = recommendation.actionType || "review your payment method";

    return `Subject: Follow-up regarding your payment

Hello ${customerName},

We noticed that your payment of ${currency} ${amount} could not be completed.

Please review your payment details and ${String(action).toLowerCase().replaceAll("_", " ")} to complete your purchase.

If you need assistance, please feel free to contact us.

Thank you,
Your Merchant Team`;
}




async function generateRecoveryMessage(payment, recommendation) {
    try {
        const prompt = `
You are RecoverAI, an assistant helping merchants communicate with customers.

Payment information:
${JSON.stringify(payment, null, 2)}

Recovery recommendation:
${JSON.stringify(recommendation, null, 2)}

Write a short, polite and personalized payment recovery email.

Rules:
- Do not include sensitive payment information.
- Do not claim payment was successful.
- Do not threaten or pressure the customer.
- Ask the customer to review or update their payment method when appropriate.
- Do not invent checkout links.
- Keep the message professional.

Return only the email subject and body.
`;

        return await generateAIResponse(prompt);

    } catch (error) {
        console.error(
            "Gemini recovery message failed. Using rule-based fallback:",
            error.message
        );

        return generateFallbackRecoveryMessage(
            payment,
            recommendation
        );
    }
}



module.exports = {
    generateAIResponse,
    analyzePaymentFailure,
    generateRecoveryMessage
};
