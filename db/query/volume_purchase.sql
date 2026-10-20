-- name: GetPurchasableVolumeForTenant :one
-- A volume on sale on the calling surface: published, every one of its
-- episodes sold there, and holding at least one episode the surface lists,
-- which also makes it a volume of a published series the surface shows. A
-- surface cannot sell what it cannot show, and a volume none of whose episodes
-- is out yet sells nothing the reader could open.
SELECT v.id,
    v.public_id,
    v.title,
    v.price,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM volumes v
    JOIN series s ON s.tenant_id = v.tenant_id
    AND s.id = v.series_id
WHERE v.tenant_id = sqlc.arg('tenant_id')
    AND v.id = sqlc.arg('id')
    AND v.is_published
    AND EXISTS (
        SELECT 1
        FROM volume_purchase_surfaces vps
        WHERE vps.volume_id = v.id
            AND vps.surface = sqlc.arg('surface')::text
    )
    AND EXISTS (
        SELECT 1
        FROM volume_episodes ve
            JOIN published_episode_surfaces pes ON pes.tenant_id = ve.tenant_id
            AND pes.episode_id = ve.episode_id
        WHERE ve.tenant_id = v.tenant_id
            AND ve.volume_id = v.id
            AND pes.surface = sqlc.arg('surface')::text
    );

-- name: HoldsStandingVolumePurchase :one
-- Whether the reader holds a purchase of the volume that still opens it.
SELECT EXISTS (
        SELECT 1
        FROM purchases p
        WHERE p.tenant_id = sqlc.arg('tenant_id')
            -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's purchase.
            AND p.user_id = sqlc.arg('user_id')::uuid
            AND p.volume_id = sqlc.arg('volume_id')::uuid
            AND p.revoked_at IS NULL
    );

-- name: ReaderIsCreditedOnVolume :one
-- Whether the reader's account is linked to a creator one of the volume's
-- episodes credits, which keeps them from buying it as it keeps them from
-- buying the episode.
SELECT EXISTS (
        SELECT 1
        FROM volume_episodes ve
            JOIN episode_creators ec ON ec.tenant_id = ve.tenant_id
            AND ec.episode_id = ve.episode_id
            JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
            AND ca.creator_id = ec.creator_id
        WHERE ve.tenant_id = sqlc.arg('tenant_id')
            AND ve.volume_id = sqlc.arg('volume_id')
            AND ca.user_id = sqlc.arg('user_id')::uuid
    );

-- name: RecordExpiredVolumeCheckout :exec
-- Records the checkout the provider reports expired as the reader's latest on
-- the volume, as RecordExpiredCheckout does for an episode. A reader or a
-- volume deleted since the checkout started records nothing.
INSERT INTO expired_volume_checkouts (
    tenant_id,
    user_id,
    volume_id,
    provider,
    provider_checkout_id
)
SELECT u.tenant_id,
    u.id,
    v.id,
    sqlc.arg('provider')::text,
    sqlc.arg('provider_checkout_id')::text
FROM users u
    JOIN volumes v ON v.tenant_id = u.tenant_id
WHERE u.tenant_id = sqlc.arg('tenant_id')::uuid
    AND u.id = sqlc.arg('user_id')
    AND v.id = sqlc.arg('volume_id')
ON CONFLICT (tenant_id, user_id, volume_id) DO
UPDATE
SET provider = EXCLUDED.provider,
    provider_checkout_id = EXCLUDED.provider_checkout_id,
    expired_at = NOW();

-- name: GetExpiredVolumeCheckoutID :one
SELECT provider_checkout_id
FROM expired_volume_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND volume_id = sqlc.arg('volume_id');

-- name: GetLastPaidVolumeCheckoutID :one
-- The provider checkout of the reader's latest purchase of the volume, which
-- the next checkout's idempotency key names, as GetLastPaidCheckoutID does
-- for an episode.
SELECT provider_checkout_id::text
FROM purchases
WHERE tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's purchase.
    AND user_id = sqlc.arg('user_id')::uuid
    AND volume_id = sqlc.arg('volume_id')::uuid
    AND provider_checkout_id IS NOT NULL
ORDER BY purchased_at DESC,
    id DESC
LIMIT 1;

-- name: CreatePurchaseFromProviderVolumeCheckout :one
-- Records the purchase of a volume a completed checkout paid for, by the rules
-- CreatePurchaseFromProviderCheckout records an episode's: every paid checkout
-- is a purchase of its own, and a redelivery of the same checkout is no row. A
-- volume is never rented and never expires.
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    volume_id,
    price_at_purchase,
    provider,
    provider_checkout_id,
    provider_payment_id,
    is_test,
    currency,
    kind,
    provider_promotion_code_id
)
VALUES (
    sqlc.arg('id')::uuid,
    sqlc.arg('tenant_id')::uuid,
    sqlc.arg('user_id')::uuid,
    sqlc.arg('volume_id')::uuid,
    sqlc.arg('price_at_purchase')::integer,
    sqlc.arg('provider')::text,
    sqlc.arg('provider_checkout_id')::text,
    sqlc.narg('provider_payment_id')::text,
    sqlc.arg('is_test')::boolean,
    sqlc.arg('currency')::text,
    'purchase',
    sqlc.narg('provider_promotion_code_id')::text
)
ON CONFLICT (provider, provider_checkout_id) DO NOTHING
RETURNING *;

-- name: CreateVolumePurchaseEpisodes :exec
-- Writes down the episodes a purchase of a volume paid for, as the volume
-- holds them now, and the part of what the reader paid each accounts for,
-- which is what a royalty statement credits each episode's creators with. The
-- amount is spread in proportion to the episodes' own prices, or evenly when
-- none of them has one, and each part is what the running total up to and
-- including it comes to less what the total before it came to, each rounded
-- down, so the parts add up to the amount exactly.
WITH items AS (
    SELECT p.tenant_id,
        p.id AS purchase_id,
        p.price_at_purchase::bigint AS paid,
        ve.episode_id,
        ve."position",
        COALESCE(el.price, 0) AS list_price
    FROM purchases p
        JOIN volume_episodes ve ON ve.tenant_id = p.tenant_id
        AND ve.volume_id = p.volume_id
        LEFT JOIN episode_listings el ON el.episode_id = ve.episode_id
    WHERE p.tenant_id = sqlc.arg('tenant_id')
        AND p.id = sqlc.arg('purchase_id')
),
weighted AS (
    SELECT items.*,
        CASE
            WHEN sum(items.list_price) OVER () > 0 THEN items.list_price
            ELSE 1
        END::bigint AS weight
    FROM items
),
running AS (
    SELECT weighted.*,
        (sum(weighted.weight) OVER (
            ORDER BY weighted."position", weighted.episode_id
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        ))::bigint AS up_to,
        (sum(weighted.weight) OVER ())::bigint AS total
    FROM weighted
)
INSERT INTO volume_purchase_episodes (
    tenant_id,
    purchase_id,
    episode_id,
    "position",
    list_price,
    price
)
SELECT running.tenant_id,
    running.purchase_id,
    running.episode_id,
    running."position",
    running.list_price,
    (running.paid * running.up_to / running.total - running.paid * (running.up_to - running.weight) / running.total)::integer
FROM running;
