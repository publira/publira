-- name: GetTenantAnalyticsSettings :one
-- Returns no rows for a tenant that has saved nothing, which reads as no tag.
SELECT *
FROM tenant_analytics_settings
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: LockTenantForAnalyticsSettings :one
-- Serializes the saves of one tenant's settings, so a save compared against
-- the row as unchanged cannot answer a value a concurrent save replaced, and
-- two first saves in gateway mode cannot each generate a path of their own.
-- The lock is on the tenant rather than its settings row, which a tenant that
-- has saved nothing does not have, and the settings are read by the next
-- statement rather than this one, for the reason
-- LockTenantForReaderIconChange gives. NO KEY UPDATE rather than UPDATE, so it
-- does not hold back the foreign key checks every write naming the tenant
-- makes.
SELECT id
FROM tenants
WHERE id = sqlc.arg('tenant_id')
FOR NO KEY UPDATE;

-- name: UpsertTenantAnalyticsSettings :one
INSERT INTO tenant_analytics_settings (
        tenant_id,
        ga4_measurement_id,
        gtm_container_id,
        serving_mode,
        server_container_url,
        gateway_path,
        consent_mode
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.narg('ga4_measurement_id'),
        sqlc.narg('gtm_container_id'),
        sqlc.arg('serving_mode'),
        sqlc.narg('server_container_url'),
        sqlc.narg('gateway_path'),
        sqlc.arg('consent_mode')
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET ga4_measurement_id = EXCLUDED.ga4_measurement_id,
    gtm_container_id = EXCLUDED.gtm_container_id,
    serving_mode = EXCLUDED.serving_mode,
    server_container_url = EXCLUDED.server_container_url,
    gateway_path = EXCLUDED.gateway_path,
    consent_mode = EXCLUDED.consent_mode,
    updated_at = NOW()
RETURNING *;
