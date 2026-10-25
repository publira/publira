-- name: ListCoinPacksForTenant :many
-- The packs the tenant has not retired, in the order it sells them.
SELECT *
FROM tenant_coin_packs
WHERE tenant_id = $1
    AND retired_at IS NULL
ORDER BY sort_order,
    id;

-- name: LockCoinPackForTenant :one
-- A pack the tenant has not retired, locked for the write that follows.
SELECT *
FROM tenant_coin_packs
WHERE tenant_id = $1
    AND id = $2
    AND retired_at IS NULL
FOR UPDATE;

-- name: LockTenantForCoinPacks :one
-- Serializes the creates of one tenant, so two of them cannot both count one
-- short of the cap and both be stored. NO KEY UPDATE rather than UPDATE, so it
-- does not hold back the foreign key checks every write naming the tenant
-- makes.
SELECT id
FROM tenants
WHERE id = $1
FOR NO KEY UPDATE;

-- name: CountCoinPacksForTenant :one
-- The packs the tenant has not retired, which are what its cap counts.
SELECT COUNT(*)::integer
FROM tenant_coin_packs
WHERE tenant_id = $1
    AND retired_at IS NULL;

-- name: CreateCoinPack :one
INSERT INTO tenant_coin_packs (
        id,
        tenant_id,
        public_id,
        coins,
        bonus_coins,
        price,
        sort_order,
        on_sale
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('public_id'),
        sqlc.arg('coins'),
        sqlc.arg('bonus_coins'),
        sqlc.arg('price'),
        sqlc.arg('sort_order'),
        sqlc.arg('on_sale')
    )
RETURNING *;

-- name: UpdateCoinPack :one
UPDATE tenant_coin_packs
SET coins = sqlc.arg('coins'),
    bonus_coins = sqlc.arg('bonus_coins'),
    price = sqlc.arg('price'),
    sort_order = sqlc.arg('sort_order'),
    on_sale = sqlc.arg('on_sale'),
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
RETURNING *;

-- name: RetireCoinPack :exec
UPDATE tenant_coin_packs
SET retired_at = NOW(),
    on_sale = false,
    updated_at = NOW()
WHERE tenant_id = $1
    AND id = $2;
