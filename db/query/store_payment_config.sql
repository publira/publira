-- name: GetTenantAppStoreConfigByTenantID :one
SELECT *
FROM tenant_app_store_config
WHERE tenant_id = $1
LIMIT 1;

-- name: UpsertTenantAppStoreConfig :one
INSERT INTO tenant_app_store_config (
        tenant_id,
        enabled,
        issuer_id,
        key_id,
        private_key_encrypted,
        private_key_hint,
        updated_at
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('enabled'),
        sqlc.narg('issuer_id'),
        sqlc.narg('key_id'),
        sqlc.narg('private_key_encrypted'),
        sqlc.narg('private_key_hint'),
        NOW()
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET enabled = EXCLUDED.enabled,
    issuer_id = EXCLUDED.issuer_id,
    key_id = EXCLUDED.key_id,
    private_key_encrypted = EXCLUDED.private_key_encrypted,
    private_key_hint = EXCLUDED.private_key_hint,
    updated_at = NOW()
RETURNING *;

-- name: GetTenantGooglePlayConfigByTenantID :one
SELECT *
FROM tenant_google_play_config
WHERE tenant_id = $1
LIMIT 1;

-- name: UpsertTenantGooglePlayConfig :one
INSERT INTO tenant_google_play_config (
        tenant_id,
        enabled,
        service_account_email,
        service_account_key_encrypted,
        service_account_key_hint,
        updated_at
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('enabled'),
        sqlc.narg('service_account_email'),
        sqlc.narg('service_account_key_encrypted'),
        sqlc.narg('service_account_key_hint'),
        NOW()
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET enabled = EXCLUDED.enabled,
    service_account_email = EXCLUDED.service_account_email,
    service_account_key_encrypted = EXCLUDED.service_account_key_encrypted,
    service_account_key_hint = EXCLUDED.service_account_key_hint,
    updated_at = NOW()
RETURNING *;
