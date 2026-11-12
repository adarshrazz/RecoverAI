
-- ==========================================
-- RECOVERAI DATABASE SCHEMA
-- ==========================================

-- 1. USERS
CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'merchant'
        CHECK (role IN ('merchant', 'admin')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. CUSTOMERS
CREATE TABLE IF NOT EXISTS customers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    merchant_id BIGINT NOT NULL REFERENCES users(id),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(30),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (id, merchant_id),
    UNIQUE (merchant_id, email)
);

-- 3. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    merchant_id BIGINT NOT NULL REFERENCES users(id),
    customer_id BIGINT NOT NULL,
    paypal_order_id VARCHAR(150) UNIQUE,
    paypal_capture_id VARCHAR(150) UNIQUE,
    amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN (
            'pending', 'approved', 'completed',
            'failed', 'cancelled', 'refunded',
            'requires_action'
        )),
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (customer_id, merchant_id)
        REFERENCES customers(id, merchant_id)
);

-- 4. PAYMENT ATTEMPTS
CREATE TABLE IF NOT EXISTS payment_attempts (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    status VARCHAR(30) NOT NULL,
    failure_code VARCHAR(100),
    failure_message TEXT,
    attempted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (payment_id, attempt_number)
);

-- 5. FAILURE ANALYSIS
CREATE TABLE IF NOT EXISTS failure_analysis (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    attempt_id BIGINT REFERENCES payment_attempts(id),
    failure_category VARCHAR(100),
    explanation TEXT,
    confidence NUMERIC(5,4),
    model_name VARCHAR(150),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. RECOVERY RECOMMENDATIONS
CREATE TABLE IF NOT EXISTS recovery_recommendations (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    analysis_id BIGINT REFERENCES failure_analysis(id),
    action_type VARCHAR(100) NOT NULL,
    rationale TEXT NOT NULL,
    message_draft TEXT,
    priority VARCHAR(20) DEFAULT 'medium',
    status VARCHAR(20) DEFAULT 'suggested',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. RECOVERY ACTIONS
CREATE TABLE IF NOT EXISTS recovery_actions (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    recommendation_id BIGINT REFERENCES recovery_recommendations(id),
    initiated_by BIGINT REFERENCES users(id),
    action_type VARCHAR(100) NOT NULL,
    status VARCHAR(30) DEFAULT 'pending',
    checkout_url TEXT,
    external_reference VARCHAR(150),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

-- 8. NOTIFICATIONS
CREATE TABLE IF NOT EXISTS notifications (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    payment_id BIGINT NOT NULL REFERENCES payments(id),
    recovery_action_id BIGINT REFERENCES recovery_actions(id),
    channel VARCHAR(20) NOT NULL,
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    message TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 9. WEBHOOK EVENTS
CREATE TABLE IF NOT EXISTS webhook_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    provider VARCHAR(30) NOT NULL DEFAULT 'paypal',
    provider_event_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(150) NOT NULL,
    resource_id VARCHAR(150),
    payload JSONB NOT NULL,
    processing_status VARCHAR(20) DEFAULT 'received',
    received_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    processing_error TEXT,
    UNIQUE (provider, provider_event_id)
);

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX IF NOT EXISTS idx_customers_merchant
ON customers(merchant_id);

CREATE INDEX IF NOT EXISTS idx_payments_merchant
ON payments(merchant_id);

CREATE INDEX IF NOT EXISTS idx_payments_status
ON payments(status);

CREATE INDEX IF NOT EXISTS idx_payments_created
ON payments(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attempts_payment
ON payment_attempts(payment_id);

CREATE INDEX IF NOT EXISTS idx_analysis_payment
ON failure_analysis(payment_id);

CREATE INDEX IF NOT EXISTS idx_recommendations_payment
ON recovery_recommendations(payment_id);

CREATE INDEX IF NOT EXISTS idx_actions_payment
ON recovery_actions(payment_id);

CREATE INDEX IF NOT EXISTS idx_notifications_payment
ON notifications(payment_id);
