CREATE TABLE user_password_reset_tokens (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_password_reset_tokens_user_id
    ON user_password_reset_tokens (user_id);

CREATE INDEX idx_user_password_reset_tokens_tenant_token
    ON user_password_reset_tokens (tenant_id, token_hash);
