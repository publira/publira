CREATE TABLE user_email_change_tokens (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    current_email VARCHAR(255) NOT NULL,
    new_email VARCHAR(255) NOT NULL,
    current_email_token_hash TEXT NOT NULL UNIQUE,
    new_email_token_hash TEXT NOT NULL UNIQUE,
    current_email_confirmed_at TIMESTAMPTZ,
    new_email_confirmed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_user_email_change_tokens_user_id
    ON user_email_change_tokens (user_id);

CREATE INDEX idx_user_email_change_tokens_tenant_current_token
    ON user_email_change_tokens (tenant_id, current_email_token_hash);

CREATE INDEX idx_user_email_change_tokens_tenant_new_token
    ON user_email_change_tokens (tenant_id, new_email_token_hash);
