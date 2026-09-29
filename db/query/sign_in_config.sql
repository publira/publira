-- name: GetTenantAppleSignInConfig :one
-- Returns no rows for a tenant that has saved nothing, which reads as Apple
-- sign-in disabled.
SELECT *
FROM tenant_apple_sign_in_config
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: UpsertTenantAppleSignInConfig :one
INSERT INTO tenant_apple_sign_in_config (
        tenant_id,
        enabled,
        services_id,
        team_id,
        key_id,
        private_key_encrypted,
        private_key_hint
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('enabled'),
        sqlc.narg('services_id'),
        sqlc.narg('team_id'),
        sqlc.narg('key_id'),
        sqlc.narg('private_key_encrypted'),
        sqlc.narg('private_key_hint')
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET enabled = EXCLUDED.enabled,
    services_id = EXCLUDED.services_id,
    team_id = EXCLUDED.team_id,
    key_id = EXCLUDED.key_id,
    private_key_encrypted = EXCLUDED.private_key_encrypted,
    private_key_hint = EXCLUDED.private_key_hint,
    updated_at = NOW()
RETURNING *;

-- name: GetTenantGoogleSignInConfig :one
-- Returns no rows for a tenant that has saved nothing, which reads as Google
-- sign-in disabled.
SELECT *
FROM tenant_google_sign_in_config
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: UpsertTenantGoogleSignInConfig :one
INSERT INTO tenant_google_sign_in_config (
        tenant_id,
        enabled,
        web_client_id,
        ios_client_id
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('enabled'),
        sqlc.narg('web_client_id'),
        sqlc.narg('ios_client_id')
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET enabled = EXCLUDED.enabled,
    web_client_id = EXCLUDED.web_client_id,
    ios_client_id = EXCLUDED.ios_client_id,
    updated_at = NOW()
RETURNING *;
