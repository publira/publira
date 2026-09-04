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

-- name: GetPurchasableEpisodeByPublicIDForTenant :one
SELECT e.id,
    e.public_id,
    e.title,
    s.public_id AS series_public_id,
    el.price,
    el.reading_period_hours
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE e.public_id = sqlc.arg('public_id')
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
LIMIT 1;

-- name: UserHasValidPurchaseForEpisode :one
SELECT EXISTS (
    SELECT 1
    FROM purchases
    WHERE tenant_id = sqlc.arg('tenant_id')
        -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
        AND user_id = sqlc.arg('user_id')::uuid
        AND episode_id = sqlc.arg('episode_id')
        AND (expires_at IS NULL OR expires_at > NOW())
) AS has_purchase;

-- name: ListMyPurchasesDesc :many
SELECT p.id,
    p.price_at_purchase,
    p.expires_at,
    p.purchased_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    e.order_index AS episode_order_index,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM purchases p
    JOIN episodes e ON e.id = p.episode_id
    JOIN series s ON s.id = e.series_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted buyer's NULL is in nobody's library.
    AND p.user_id = sqlc.arg('user_id')::uuid
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_purchased_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) <= (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) < (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY p.purchased_at DESC,
    p.id DESC
LIMIT sqlc.arg('limit');

-- name: ListMyPurchasesAsc :many
SELECT p.id,
    p.price_at_purchase,
    p.expires_at,
    p.purchased_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    e.order_index AS episode_order_index,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM purchases p
    JOIN episodes e ON e.id = p.episode_id
    JOIN series s ON s.id = e.series_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted buyer's NULL is in nobody's library.
    AND p.user_id = sqlc.arg('user_id')::uuid
    AND e.tenant_id = sqlc.arg('tenant_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_purchased_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) >= (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (p.purchased_at, p.id) > (
                sqlc.narg('cursor_purchased_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY p.purchased_at ASC,
    p.id ASC
LIMIT sqlc.arg('limit');

-- name: CreatePurchaseFromStripeCheckout :one
-- The advisory lock serializes different Stripe Checkout sessions for the same
-- buyer and episode. Stripe's request idempotency prevents duplicate sessions
-- in the ordinary case; this also keeps an exceptional concurrent pair from
-- producing two entitlements.
WITH locked AS (
    SELECT pg_advisory_xact_lock(
        hashtextextended(
            sqlc.arg('tenant_id')::uuid::text || ':' ||
                sqlc.arg('user_id')::uuid::text || ':' ||
                sqlc.arg('episode_id')::uuid::text,
            0
        )
    )
)
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    price_at_purchase,
    expires_at,
    stripe_checkout_session_id
)
SELECT
    sqlc.arg('id')::uuid,
    sqlc.arg('tenant_id')::uuid,
    sqlc.arg('user_id')::uuid,
    sqlc.arg('episode_id')::uuid,
    sqlc.arg('price_at_purchase')::integer,
    sqlc.narg('expires_at')::timestamptz,
    sqlc.narg('stripe_checkout_session_id')::text
FROM locked
WHERE NOT EXISTS (
    SELECT 1
    FROM purchases
    WHERE tenant_id = sqlc.arg('tenant_id')::uuid
        AND user_id = sqlc.arg('user_id')::uuid
        AND episode_id = sqlc.arg('episode_id')::uuid
        AND (expires_at IS NULL OR expires_at > NOW())
)
ON CONFLICT (stripe_checkout_session_id) DO NOTHING
RETURNING *;
