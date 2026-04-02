CREATE TABLE platform_user_email_change_tokens (
    id UUID PRIMARY KEY,
    platform_user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
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

CREATE INDEX idx_platform_user_email_change_tokens_user_id
    ON platform_user_email_change_tokens (platform_user_id);

CREATE INDEX idx_platform_user_email_change_tokens_current_token
    ON platform_user_email_change_tokens (current_email_token_hash);

CREATE INDEX idx_platform_user_email_change_tokens_new_token
    ON platform_user_email_change_tokens (new_email_token_hash);
