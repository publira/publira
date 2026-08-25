-- name: GetTenantPaymentConfigByTenantID :one
SELECT *
FROM tenant_payment_config
WHERE tenant_id = $1
LIMIT 1;

-- name: GetEnabledTenantPaymentConfigByTenantID :one
SELECT *
FROM tenant_payment_config
WHERE tenant_id = $1
    AND enabled = TRUE
LIMIT 1;

-- name: UpsertTenantPaymentConfig :one
INSERT INTO tenant_payment_config (
        tenant_id,
        provider,
        enabled,
        secret_key_encrypted,
        webhook_secret_encrypted,
        secret_key_hint,
        webhook_secret_hint,
        updated_at
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) ON CONFLICT (tenant_id) DO
UPDATE
SET provider = EXCLUDED.provider,
    enabled = EXCLUDED.enabled,
    secret_key_encrypted = EXCLUDED.secret_key_encrypted,
    webhook_secret_encrypted = EXCLUDED.webhook_secret_encrypted,
    secret_key_hint = EXCLUDED.secret_key_hint,
    webhook_secret_hint = EXCLUDED.webhook_secret_hint,
    updated_at = NOW()
RETURNING *;
