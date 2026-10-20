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

-- name: ListTenantStoreProductPrices :many
-- The prices a tenant's app sells episodes at, so each one has a store product:
-- each episode's own price, and the price of every campaign on it that has not
-- ended. Drafts, scheduled episodes, and scheduled campaigns count: their
-- product has to exist before they go on sale. An episode counts once at a
-- price, however many of its campaigns share it.
WITH app_episodes AS (
    SELECT e.id,
        el.price
    FROM episodes e
        JOIN episode_listings el ON el.episode_id = e.id
        JOIN episode_purchase_availability epa ON epa.episode_id = e.id
    WHERE e.tenant_id = sqlc.arg('tenant_id')
        AND el.price > 0
        AND epa.purchase_availability IN ('all', 'app')
        -- The app cannot sell an episode it does not show.
        AND EXISTS (
            SELECT 1
            FROM episode_surfaces es
            WHERE es.episode_id = e.id
                AND es.surface = 'app'
        )
),
app_prices AS (
    SELECT ae.id AS episode_id,
        ae.price
    FROM app_episodes ae
    UNION
    SELECT cp.episode_id,
        cp.price
    FROM episode_campaign_prices cp
        JOIN app_episodes ae ON ae.id = cp.episode_id
    WHERE cp.ends_at > NOW()
        -- A campaign that no longer undercuts the listing never opens, as
        -- open_episode_campaign_prices reads it, so it sells nothing.
        AND cp.price < ae.price
)
SELECT price,
    COUNT(*)::integer AS episode_count
FROM app_prices
GROUP BY price
ORDER BY price;

-- name: ListTenantsSellingOnGooglePlay :many
-- The tenants whose Google Play store is enabled and names its app, which are
-- the ones whose voided purchases the worker reads. Read across tenants, so
-- only a role that bypasses row-level security sees them all.
SELECT gp.tenant_id
FROM tenant_google_play_config gp
    JOIN tenant_config tc ON tc.tenant_id = gp.tenant_id
WHERE gp.enabled
    AND tc.android_application_id IS NOT NULL
ORDER BY gp.tenant_id;
