-- name: GetTenantAnalyticsSettings :one
-- Returns no rows for a tenant that has saved nothing, which reads as no tag.
SELECT *
FROM tenant_analytics_settings
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: LockTenantAnalyticsSettings :one
-- Serializes the saves of one tenant's settings, so a save compared against
-- the row as unchanged cannot answer a value a concurrent save replaced.
SELECT *
FROM tenant_analytics_settings
WHERE tenant_id = sqlc.arg('tenant_id')
FOR UPDATE;

-- name: UpsertTenantAnalyticsSettings :one
INSERT INTO tenant_analytics_settings (
        tenant_id,
        ga4_measurement_id,
        gtm_container_id,
        serving_mode,
        server_container_url,
        gateway_path
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.narg('ga4_measurement_id'),
        sqlc.narg('gtm_container_id'),
        sqlc.arg('serving_mode'),
        sqlc.narg('server_container_url'),
        sqlc.narg('gateway_path')
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET ga4_measurement_id = EXCLUDED.ga4_measurement_id,
    gtm_container_id = EXCLUDED.gtm_container_id,
    serving_mode = EXCLUDED.serving_mode,
    server_container_url = EXCLUDED.server_container_url,
    gateway_path = EXCLUDED.gateway_path,
    updated_at = NOW()
RETURNING *;
