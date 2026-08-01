-- Access-token auth: credentials_version for JWT invalidation; drop session tables.

ALTER TABLE users
    ADD COLUMN credentials_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE platform_users
    ADD COLUMN credentials_version INTEGER NOT NULL DEFAULT 1;

DROP INDEX IF EXISTS idx_sessions_tenant_token_hash;
DROP INDEX IF EXISTS idx_sessions_user_id;
DROP TABLE IF EXISTS sessions;

DROP INDEX IF EXISTS idx_platform_sessions_platform_user_id;
DROP TABLE IF EXISTS platform_sessions;
