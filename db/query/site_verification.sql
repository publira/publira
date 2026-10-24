-- name: GetTenantSiteVerification :one
-- Returns no rows for a tenant that has saved nothing, which reads as no code.
SELECT *
FROM tenant_site_verification
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: LockTenantForSiteVerification :one
-- Serializes the saves of one tenant's codes, so a save compared against the
-- row as unchanged cannot answer a value a concurrent save replaced. The lock
-- is on the tenant rather than its row, which a tenant that has saved nothing
-- does not have, for the reasons LockTenantForAnalyticsSettings gives.
SELECT id
FROM tenants
WHERE id = sqlc.arg('tenant_id')
FOR NO KEY UPDATE;

-- name: UpsertTenantSiteVerification :one
INSERT INTO tenant_site_verification (
        tenant_id,
        google_site_verification,
        bing_site_verification
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.narg('google_site_verification'),
        sqlc.narg('bing_site_verification')
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET google_site_verification = EXCLUDED.google_site_verification,
    bing_site_verification = EXCLUDED.bing_site_verification,
    updated_at = NOW()
RETURNING *;
