CREATE TABLE platform_user_password_reset_tokens (
    id UUID PRIMARY KEY,
    platform_user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_user_password_reset_tokens_user_id
    ON platform_user_password_reset_tokens (platform_user_id);

CREATE INDEX idx_platform_user_password_reset_tokens_token_hash
    ON platform_user_password_reset_tokens (token_hash);