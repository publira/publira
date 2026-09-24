-- name: GetPlatformSMTPConfig :one
SELECT *
FROM platform_smtp_config
WHERE singleton = TRUE
LIMIT 1;

-- name: LockPlatformSMTPConfig :one
-- Reads the row for update, so the revision a save compares against, and the
-- stored password it carries forward, cannot change before the write.
SELECT *
FROM platform_smtp_config
WHERE singleton = TRUE
FOR UPDATE;

-- name: InsertPlatformSMTPConfig :one
-- No ON CONFLICT clause: an absent row leaves LockPlatformSMTPConfig nothing
-- to lock, so a losing racer must fail on the primary key rather than
-- overwrite the row the winner just created.
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
VALUES (TRUE, $1, $2, $3, $4, $5, $6, $7, NOW())
RETURNING *;

-- name: UpdatePlatformSMTPConfig :one
-- Writes every value over the existing row. The revision moves with every
-- write, which is what makes a save based on an earlier read detectable.
UPDATE platform_smtp_config
SET host = $1,
    port = $2,
    username = $3,
    password_encrypted = $4,
    encryption = $5,
    from_address = $6,
    reply_to = $7,
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton = TRUE
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
