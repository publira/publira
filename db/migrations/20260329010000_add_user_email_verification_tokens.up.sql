-- Add user email verification token storage and optional verified timestamp

ALTER TABLE users
ADD COLUMN email_verified_at TIMESTAMPTZ;

CREATE TABLE user_email_verification_tokens (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_email_verification_tokens_user_id
    ON user_email_verification_tokens (user_id);

CREATE INDEX idx_user_email_verification_tokens_tenant_token
    ON user_email_verification_tokens (tenant_id, token_hash);
