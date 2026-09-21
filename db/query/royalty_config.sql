-- name: GetTenantRoyaltyConfigByTenantID :one
SELECT *
FROM tenant_royalty_config
WHERE tenant_id = $1
LIMIT 1;

-- name: ListAutomaticRoyaltyConfigs :many
-- Every tenant that chose automatic closing, for the maintenance pass that
-- closes their months across tenants.
SELECT *
FROM tenant_royalty_config
WHERE close_mode = 'automatic'
ORDER BY tenant_id;

-- name: UpsertTenantRoyaltyConfig :one
INSERT INTO tenant_royalty_config (
    tenant_id,
    close_mode,
    auto_close_day,
    automatic_since,
    updated_at
)
VALUES (
    $1,
    $2,
    $3,
    CASE WHEN $2 = 'automatic' THEN NOW() ELSE NULL END,
    NOW()
)
ON CONFLICT (tenant_id) DO UPDATE
SET close_mode = EXCLUDED.close_mode,
    auto_close_day = EXCLUDED.auto_close_day,
    automatic_since = CASE
        WHEN EXCLUDED.close_mode = 'automatic'
            AND tenant_royalty_config.close_mode <> 'automatic' THEN NOW()
        WHEN EXCLUDED.close_mode = 'manual' THEN NULL
        ELSE tenant_royalty_config.automatic_since
    END,
    updated_at = NOW()
RETURNING *;
