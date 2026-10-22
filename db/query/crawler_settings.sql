-- name: GetTenantCrawlerSettings :one
-- Returns no rows for a tenant that has saved nothing, which reads as nothing
-- excluded.
SELECT *
FROM tenant_crawler_settings
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: UpsertTenantCrawlerSettings :one
-- The user agents and paths arrive validated, normalized, and without
-- duplicates.
INSERT INTO tenant_crawler_settings (tenant_id, excluded_user_agents, excluded_paths)
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('excluded_user_agents')::text[],
        sqlc.arg('excluded_paths')::text[]
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET excluded_user_agents = EXCLUDED.excluded_user_agents,
    excluded_paths = EXCLUDED.excluded_paths,
    updated_at = NOW()
RETURNING *;
