-- Simple database schema
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE calls (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    external_call_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    ended_at TIMESTAMP
);

-- Basic indexes
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_calls_phone_active ON calls((payload->>'to')) WHERE status = 'IN_PROGRESS';