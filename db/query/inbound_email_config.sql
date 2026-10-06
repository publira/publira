-- A tenant's inbound email settings. Only internal/inboundemail calls these:
-- the rows carry ciphertext.
--
-- Expected plans:
--   every query -> tenant_inbound_email_config_pkey

-- name: GetTenantInboundEmailConfigByTenantID :one
SELECT *
FROM tenant_inbound_email_config
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: GetEnabledTenantInboundEmailConfigByTenantID :one
SELECT *
FROM tenant_inbound_email_config
WHERE tenant_id = sqlc.arg('tenant_id')
    AND enabled = TRUE;

-- name: UpsertTenantInboundEmailConfig :one
INSERT INTO tenant_inbound_email_config (
    tenant_id,
    provider,
    enabled,
    domain,
    credentials_encrypted,
    credential_hints,
    updated_at
) VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('provider'),
    sqlc.arg('enabled'),
    sqlc.narg('domain'),
    sqlc.arg('credentials_encrypted'),
    sqlc.arg('credential_hints'),
    NOW()
)
ON CONFLICT (tenant_id) DO UPDATE
SET provider = EXCLUDED.provider,
    enabled = EXCLUDED.enabled,
    domain = EXCLUDED.domain,
    credentials_encrypted = EXCLUDED.credentials_encrypted,
    credential_hints = EXCLUDED.credential_hints,
    updated_at = NOW()
RETURNING *;
