const pool = require("../config/database");

const recoveryRules = {
    CARD_DECLINED: {
        actionType: "UPDATE_PAYMENT_METHOD",
        baseScore: 35,
        rationale: "The payment method was declined. The customer should provide another payment method.",
        messageDraft:
            "Hello, we couldn't complete your payment. Please review your payment method and try again using an eligible payment method."
    },

    INSUFFICIENT_FUNDS: {
        actionType: "RETRY_LATER",
        baseScore: 20,
        rationale: "The payment could not be completed due to insufficient funds. A later retry may be appropriate after confirmation.",
        messageDraft:
            "Hello, your payment could not be completed. Please check your available balance and contact us when you're ready to try again."
    },

    AUTHENTICATION_REQUIRED: {
        actionType: "COMPLETE_AUTHENTICATION",
        baseScore: 35,
        rationale: "Additional customer authentication is required to complete the payment.",
        messageDraft:
            "Hello, your payment requires additional authentication. Please return to the secure checkout and complete the requested verification."
    },

    PAYMENT_METHOD_EXPIRED: {
        actionType: "UPDATE_PAYMENT_METHOD",
        baseScore: 30,
        rationale: "The payment method appears to have expired. The customer should update their payment method.",
        messageDraft:
            "Hello, your payment method may have expired. Please update your payment details through our secure checkout."
    },

    UNKNOWN_FAILURE: {
        actionType: "MERCHANT_REVIEW",
        baseScore: 10,
        rationale: "The payment failure could not be classified. Merchant review is recommended before taking further action.",
        messageDraft: null
    }
};

const calculatePriority = (failureCategory, createdAt) => {
    const rule =
        recoveryRules[failureCategory] ||
        recoveryRules.UNKNOWN_FAILURE;

    const ageHours = Math.max(
        0,
        (Date.now() - new Date(createdAt).getTime()) / 3600000
    );

    let ageBonus = 0;

    if (ageHours >= 72) {
        ageBonus = 25;
    } else if (ageHours >= 24) {
        ageBonus = 15;
    }

    const score = Math.min(100, rule.baseScore + ageBonus);

    const priority =
        score >= 70 ? "high" :
        score >= 40 ? "medium" :
        "low";
        
    return {
    score,
    priority,
    ageHours: Math.round(ageHours),
    baseScore: rule.baseScore,
    ageBonus,
    scoringExplanation: [
        `Failure category: ${failureCategory}`,
        `Base score: ${rule.baseScore}`,
        `Payment age: ${Math.round(ageHours)} hours`,
        `Age bonus: ${ageBonus}`,
        `Final score: ${score}/100`
    ]
};
};

const generateRecoveryRecommendation = async (
    paymentId,
    merchantId
) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const result = await client.query(
            `SELECT
                p.id AS payment_id,
                p.status AS payment_status,
                fa.id AS analysis_id,
                fa.failure_category,
                p.created_at AS payment_created_at
             FROM payments p
             JOIN failure_analysis fa
                ON fa.payment_id = p.id
             WHERE p.id = $1
               AND p.merchant_id = $2
             ORDER BY fa.created_at DESC
             LIMIT 1
             FOR UPDATE OF p`,
            [paymentId, merchantId]
        );

        if (result.rows.length === 0) {
            throw new Error(
                "No failure analysis found for this payment"
            );
        }

        const payment = result.rows[0];

        if (payment.payment_status !== "failed") {
            throw new Error(
                "Recovery recommendation is allowed only for failed payments"
            );
        }

        const rule =
            recoveryRules[payment.failure_category] ||
            recoveryRules.UNKNOWN_FAILURE;

        const scoring = calculatePriority(
            payment.failure_category,
            payment.payment_created_at
        );

        const existing = await client.query(
            `SELECT id
             FROM recovery_recommendations
             WHERE payment_id = $1
               AND analysis_id = $2
               AND status = 'active'
             LIMIT 1`,
            [payment.payment_id, payment.analysis_id]
        );

        if (existing.rows.length > 0) {
            await client.query("COMMIT");

            return {
                created: false,
                recommendationId: existing.rows[0].id,
                message: "An active recommendation already exists"
            };
        }

        const inserted = await client.query(
            `INSERT INTO recovery_recommendations (
                payment_id,
                analysis_id,
                action_type,
                rationale,
                message_draft,
                priority,
                priority_score,
                status,
                created_at
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW())
             RETURNING *`,
            [
                payment.payment_id,
                payment.analysis_id,
                rule.actionType,
                rule.rationale,
                rule.messageDraft,
                scoring.priority,
                scoring.score
            ]
        );

        await client.query("COMMIT");

        return {
            created: true,
            recommendation: inserted.rows[0],
            scoring
        };

    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error(
                "Recovery service rollback error:",
                rollbackError.message
            );
        }

        throw error;

    } finally {
        client.release();
    }
};

module.exports = {
    generateRecoveryRecommendation,
    calculatePriority
};
