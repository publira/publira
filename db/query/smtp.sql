-- name: GetPlatformSMTPConfig :one
SELECT *
FROM platform_smtp_config
WHERE singleton = TRUE
LIMIT 1;

-- name: UpsertPlatformSMTPConfig :one
INSERT INTO platform_smtp_config (
        singleton,
        host,
        port,
        username,
        password_encrypted,
        encryption,
        from_address,
        reply_to,
        updated_at
    )
VALUES (TRUE, $1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT (singleton) DO
UPDATE
SET host = EXCLUDED.host,
    port = EXCLUDED.port,
    username = EXCLUDED.username,
    password_encrypted = EXCLUDED.password_encrypted,
    encryption = EXCLUDED.encryption,
    from_address = EXCLUDED.from_address,
    reply_to = EXCLUDED.reply_to,
    updated_at = NOW()
RETURNING *;

-- name: GetTenantSMTPConfigByTenantID :one
SELECT *
FROM tenant_smtp_config
WHERE tenant_id = $1
LIMIT 1;

-- name: UpsertTenantSMTPConfig :one
INSERT INTO tenant_smtp_config (
        tenant_id,
        smtp_override_enabled,
        host,
        port,
        username,
        password_encrypted,
        encryption,
        from_name,
        from_address,
        reply_to,
        updated_at
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) ON CONFLICT (tenant_id) DO
UPDATE
SET smtp_override_enabled = EXCLUDED.smtp_override_enabled,
    host = EXCLUDED.host,
    port = EXCLUDED.port,
    username = EXCLUDED.username,
    password_encrypted = EXCLUDED.password_encrypted,
    encryption = EXCLUDED.encryption,
    from_name = EXCLUDED.from_name,
    from_address = EXCLUDED.from_address,
    reply_to = EXCLUDED.reply_to,
    updated_at = NOW()
RETURNING *;
