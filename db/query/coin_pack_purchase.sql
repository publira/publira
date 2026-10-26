-- name: GetPurchasableCoinPackForTenant :one
-- A pack the tenant has on sale now, which a checkout or a store purchase
-- intent sells at the terms read here. A pack taken off sale or retired is no
-- row, and so is one of another tenant.
SELECT id,
    public_id,
    coins,
    bonus_coins,
    price
FROM tenant_coin_packs
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND retired_at IS NULL
    AND on_sale;

-- name: RecordExpiredCoinPackCheckout :exec
-- Records the checkout the provider reports expired as the reader's latest on
-- the pack, as RecordExpiredCheckout does for an episode. A reader or a pack
-- deleted since the checkout started records nothing.
INSERT INTO expired_coin_pack_checkouts (
    tenant_id,
    user_id,
    coin_pack_id,
    provider,
    provider_checkout_id
)
SELECT u.tenant_id,
    u.id,
    cp.id,
    sqlc.arg('provider')::text,
    sqlc.arg('provider_checkout_id')::text
FROM users u
    JOIN tenant_coin_packs cp ON cp.tenant_id = u.tenant_id
WHERE u.tenant_id = sqlc.arg('tenant_id')::uuid
    AND u.id = sqlc.arg('user_id')
    AND cp.id = sqlc.arg('coin_pack_id')
ON CONFLICT (tenant_id, user_id, coin_pack_id) DO
UPDATE
SET provider = EXCLUDED.provider,
    provider_checkout_id = EXCLUDED.provider_checkout_id,
    expired_at = NOW();

-- name: GetExpiredCoinPackCheckoutID :one
SELECT provider_checkout_id
FROM expired_coin_pack_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND coin_pack_id = sqlc.arg('coin_pack_id');

-- name: GetLastPaidCoinPackCheckoutID :one
-- The provider checkout of the reader's latest purchase of the pack, which the
-- next checkout's idempotency key names, as GetLastPaidCheckoutID does for an
-- episode. A pack is bought again and again, so without it a second purchase
-- of the same pack would be answered with the checkout of the first.
SELECT provider_checkout_id::text
FROM purchases
WHERE tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's purchase.
    AND user_id = sqlc.arg('user_id')::uuid
    AND coin_pack_id = sqlc.arg('coin_pack_id')::uuid
    AND provider_checkout_id IS NOT NULL
ORDER BY purchased_at DESC,
    id DESC
LIMIT 1;

-- name: CreatePurchaseFromProviderCoinPackCheckout :one
-- Records the purchase of a pack a completed checkout paid for, by the rules
-- CreatePurchaseFromProviderCheckout records an episode's: every paid checkout
-- is a purchase of its own, and a redelivery of the same checkout is no row. A
-- pack is never rented and never expires; its coins do, by their grant.
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    coin_pack_id,
    price_at_purchase,
    provider,
    provider_checkout_id,
    provider_payment_id,
    is_test,
    currency,
    kind
)
VALUES (
    sqlc.arg('id')::uuid,
    sqlc.arg('tenant_id')::uuid,
    sqlc.arg('user_id')::uuid,
    sqlc.arg('coin_pack_id')::uuid,
    sqlc.arg('price_at_purchase')::integer,
    sqlc.arg('provider')::text,
    sqlc.arg('provider_checkout_id')::text,
    sqlc.narg('provider_payment_id')::text,
    sqlc.arg('is_test')::boolean,
    sqlc.arg('currency')::text,
    'purchase'
)
ON CONFLICT (provider, provider_checkout_id) DO NOTHING
RETURNING *;

-- name: CreateStoreCoinPackPurchase :one
-- Records a verified store transaction for a pack, as CreateStorePurchase
-- records one for an episode. A second insert of the same transaction is no
-- row and the caller reads the first.
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    coin_pack_id,
    price_at_purchase,
    store,
    store_transaction_id,
    is_test,
    currency,
    kind
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id')::uuid,
    sqlc.arg('coin_pack_id')::uuid,
    sqlc.arg('price_at_purchase'),
    sqlc.arg('store')::text,
    sqlc.arg('store_transaction_id')::text,
    sqlc.arg('is_test'),
    sqlc.arg('currency'),
    'purchase'
)
ON CONFLICT (tenant_id, store, store_transaction_id) DO NOTHING
RETURNING *;

-- name: CreateCoinPackPurchase :exec
-- Writes down the pack a purchase just recorded bought, as the reader was
-- shown it.
INSERT INTO coin_pack_purchases (tenant_id, purchase_id, coins, bonus_coins)
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('purchase_id'),
        sqlc.arg('coins'),
        sqlc.arg('bonus_coins')
    );

-- name: MarkCoinPackSold :exec
-- Records the first sale of a pack, from which on its price and coins are
-- what a purchase of it bought and never change. A pack sold before keeps the
-- instant of its first sale.
UPDATE tenant_coin_packs
SET first_sold_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND first_sold_at IS NULL;


-- name: GetCoinPackCheckoutReturnEpisode :one
-- The episode a checkout of a pack sends the reader back to, the one they
-- were short of coins for, which has to be one the calling surface shows.
SELECT e.public_id,
    s.public_id AS series_public_id
FROM episodes e
    JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('id')
    AND EXISTS (
        SELECT 1
        FROM published_episode_surfaces pes
        WHERE pes.episode_id = e.id
            AND pes.surface = sqlc.arg('surface')::text
    );
