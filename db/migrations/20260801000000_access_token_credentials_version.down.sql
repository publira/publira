CREATE TABLE sessions (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_user_id ON sessions (user_id);
CREATE INDEX idx_sessions_tenant_token_hash ON sessions (tenant_id, token_hash);

CREATE TABLE platform_sessions (
    id UUID PRIMARY KEY,
    platform_user_id UUID NOT NULL REFERENCES platform_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_sessions_platform_user_id ON platform_sessions (platform_user_id);

ALTER TABLE platform_users DROP COLUMN IF EXISTS credentials_version;
ALTER TABLE users DROP COLUMN IF EXISTS credentials_version;
