-- name: GetSeriesForRemainderSale :one
-- A currently public series the calling surface shows, with the bundle
-- discount a checkout of its rest takes off.
SELECT s.id,
    s.public_id,
    sl.bundle_discount_percent
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND EXISTS (
        SELECT 1
        FROM series_surfaces ss
        WHERE ss.series_id = s.id
            AND ss.surface = sqlc.arg('surface')::text
    )
LIMIT 1;

-- name: ListSeriesRemainderEpisodes :many
-- Every episode of the series a checkout of its rest could sell from the
-- calling surface: one the surface lists, with a price, whose permanent copy
-- the surface may sell, in the order GetSeriesDetail lists them. held is
-- whether the reader holds an active permanent copy of it already, which
-- leaves it out of the sale, and credited whether the reader's account is
-- linked to a creator it credits, which refuses the sale, as each does for the
-- episode's own checkout. A guest passes a NULL user_id, which holds nothing
-- and is credited on nothing.
SELECT e.id,
    et.title,
    el.price,
    el.reading_period_hours,
    EXISTS (
        SELECT 1
        FROM episode_content_grants g
        WHERE g.tenant_id = e.tenant_id
            AND g.user_id = sqlc.narg('user_id')::uuid
            AND g.episode_id = e.id
            AND g.purchase_kind = 'purchase'
    ) AS held,
    EXISTS (
        SELECT 1
        FROM episode_creators ec
            JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
            AND ca.creator_id = ec.creator_id
        WHERE ec.tenant_id = e.tenant_id
            AND ec.episode_id = e.id
            AND ca.user_id = sqlc.narg('user_id')::uuid
    ) AS credited
FROM episodes e
    CROSS JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et
    JOIN published_episode_surfaces pes ON pes.episode_id = e.id
    JOIN episode_listings el ON el.episode_id = e.id
    JOIN episode_purchase_availability epa ON epa.episode_id = e.id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.series_id = sqlc.arg('series_id')
    AND pes.surface = sqlc.arg('surface')::text
    AND el.price > 0
    AND epa.purchase_availability = ANY (ARRAY['all'::text, sqlc.arg('surface')::text])
ORDER BY e.order_index ASC,
    e.id ASC;

-- name: CreateSeriesBundle :one
-- Writes down the bundle a checkout of the rest of a series is about to sell,
-- with its episodes, under the idempotency key the checkout is started with.
-- The key names everything the checkout sends, so a bundle already written
-- under it holds the same episodes at the same terms: that is no row here, and
-- the caller reads the bundle's id by the key instead. The arrays are the
-- episodes in the bundle's order, one element each; a reading period of 0 is
-- none.
WITH bundle AS (
    INSERT INTO series_bundles (
            id,
            tenant_id,
            series_id,
            user_id,
            idempotency_key,
            discount_percent,
            price
        )
    VALUES (
            sqlc.arg('id')::uuid,
            sqlc.arg('tenant_id')::uuid,
            sqlc.arg('series_id')::uuid,
            sqlc.arg('user_id')::uuid,
            sqlc.arg('idempotency_key')::text,
            sqlc.narg('discount_percent')::integer,
            sqlc.arg('price')::integer
        ) ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    RETURNING id,
        tenant_id
),
episodes AS (
    INSERT INTO series_bundle_episodes (
            tenant_id,
            series_bundle_id,
            episode_id,
            "position",
            list_price,
            price,
            reading_period_hours
        )
    SELECT bundle.tenant_id,
        bundle.id,
        item.episode_id,
        (item.ordinality - 1)::integer,
        (sqlc.arg('list_prices')::integer [])[item.ordinality],
        (sqlc.arg('prices')::integer [])[item.ordinality],
        NULLIF((sqlc.arg('reading_period_hours')::integer [])[item.ordinality], 0)
    FROM bundle
        CROSS JOIN unnest(sqlc.arg('episode_ids')::uuid []) WITH ORDINALITY AS item(episode_id, ordinality)
)
SELECT id
FROM bundle;

-- name: GetSeriesBundleIDByIdempotencyKey :one
SELECT id
FROM series_bundles
WHERE tenant_id = sqlc.arg('tenant_id')
    AND idempotency_key = sqlc.arg('idempotency_key')::text;

-- name: RecordExpiredSeriesBundleCheckout :exec
-- Records the checkout the provider reports expired on the bundle it would
-- have sold, which makes it the reader's latest expired checkout of the
-- series' rest. A repeated delivery names the checkout already recorded and
-- changes nothing: moving its instant would put an older bundle ahead of one
-- that expired after it, and the next checkout's key back on that later one.
UPDATE series_bundles
SET expired_provider = sqlc.arg('provider')::text,
    expired_provider_checkout_id = sqlc.arg('provider_checkout_id')::text,
    expired_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND user_id = sqlc.arg('user_id')::uuid
    AND expired_provider_checkout_id IS DISTINCT FROM sqlc.arg('provider_checkout_id')::text;

-- name: GetExpiredSeriesBundleCheckoutID :one
-- The checkout the reader last let expire on the rest of the series, which
-- the next checkout's idempotency key names, as GetExpiredCheckoutID does for
-- an episode.
SELECT expired_provider_checkout_id::text
FROM series_bundles
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')::uuid
    AND series_id = sqlc.arg('series_id')
    AND expired_at IS NOT NULL
ORDER BY expired_at DESC,
    id DESC
LIMIT 1;

-- name: GetLastPaidSeriesBundleCheckoutID :one
-- The provider checkout of the reader's latest purchase of the rest of the
-- series, which the next checkout's idempotency key names, as
-- GetLastPaidCheckoutID does for an episode.
SELECT p.provider_checkout_id::text
FROM purchases p
    JOIN series_bundles b ON b.tenant_id = p.tenant_id
    AND b.id = p.series_bundle_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's purchase.
    AND p.user_id = sqlc.arg('user_id')::uuid
    AND b.series_id = sqlc.arg('series_id')
    AND p.provider_checkout_id IS NOT NULL
ORDER BY p.purchased_at DESC,
    p.id DESC
LIMIT 1;

-- name: CreatePurchaseFromProviderSeriesBundleCheckout :one
-- Records the purchase of a bundle a completed checkout paid for, by the rules
-- CreatePurchaseFromProviderCheckout records an episode's: every paid checkout
-- is a purchase of its own, and a redelivery of the same checkout is no row.
-- The bundle is the permanent copy of each of its episodes. An episode whose
-- copy had a reading period closes when series_bundle_episodes says it does,
-- so the purchase has no expiry of its own.
INSERT INTO purchases (
        id,
        tenant_id,
        user_id,
        series_bundle_id,
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
        sqlc.arg('series_bundle_id')::uuid,
        sqlc.arg('price_at_purchase')::integer,
        sqlc.arg('provider')::text,
        sqlc.arg('provider_checkout_id')::text,
        sqlc.narg('provider_payment_id')::text,
        sqlc.arg('is_test')::boolean,
        sqlc.arg('currency')::text,
        'purchase',
        sqlc.narg('provider_promotion_code_id')::text
    ) ON CONFLICT (provider, provider_checkout_id) DO NOTHING
RETURNING *;
