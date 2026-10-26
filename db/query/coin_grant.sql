-- name: ListUnspentCoinsForUser :many
-- The coins the reader can spend now, by when they expire, the soonest first:
-- the unspent coins of every grant that has not expired. A grant past its
-- expiry counts for nothing whether or not the expiry job has reached it yet.
SELECT expires_at,
    SUM(remaining_coins)::bigint AS coins
FROM coin_grants
WHERE tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted reader's NULL holds no coins.
    AND user_id = sqlc.arg('user_id')::uuid
    AND remaining_coins > 0
    AND expires_at > NOW()
GROUP BY expires_at
ORDER BY expires_at;

-- name: LockUnspentCoinGrantsForUser :many
-- The reader's grants a spend can draw on, in the order it draws on them: the
-- one that expires first first. The grants are locked for the draws that
-- follow, and the pack purchases that made them are not, so a refund of one
-- does not wait for the spend.
--
-- paid_amount is what the coins granted were paid for, in currency, which a
-- spend spreads over them: the price of the pack purchase that made the
-- grant. A grant made by staff was paid for by no one, a test purchase paid
-- the tenant nothing, and a pack paid in another currency than the spend's
-- cannot be added to its price, so each of those is paid 0.
SELECT g.id,
    g.coins,
    g.remaining_coins,
    (
        CASE
            WHEN p.id IS NULL
            OR p.is_test
            OR p.currency <> sqlc.arg('currency')::text THEN 0
            ELSE p.price_at_purchase
        END
    )::integer AS paid_amount
FROM coin_grants g
    LEFT JOIN purchases p ON p.tenant_id = g.tenant_id
    AND p.id = g.purchase_id
WHERE g.tenant_id = sqlc.arg('tenant_id')
    AND g.user_id = sqlc.arg('user_id')::uuid
    AND g.remaining_coins > 0
    AND g.expires_at > NOW()
ORDER BY g.expires_at,
    g.id
FOR UPDATE OF g;

-- name: DrawCoinGrant :exec
UPDATE coin_grants
SET remaining_coins = remaining_coins - sqlc.arg('coins')::integer,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: TenantHasCoinGrants :one
-- Whether the tenant has ever granted a coin, which fixes the value of one.
SELECT EXISTS (
        SELECT 1
        FROM coin_grants
        WHERE tenant_id = $1
    );

-- name: CountReadersHoldingCoins :one
-- The readers of the tenant who hold coins that have not expired, which keeps
-- the tenant's coins from being turned off.
SELECT COUNT(DISTINCT user_id)::integer
FROM coin_grants
WHERE tenant_id = $1
    AND user_id IS NOT NULL
    AND remaining_coins > 0
    AND expires_at > NOW();

-- name: ExpireLapsedCoinGrants :many
-- Records, across every tenant, the coins of up to `batch` grants that expired
-- unspent, and zeroes what the grants have left so that the next pass does not
-- reach them again. Each expiry is dated when its grant expired. A grant a
-- spend holds is passed over and reached by a later pass.
WITH lapsed AS (
    SELECT id,
        tenant_id,
        user_id,
        remaining_coins,
        expires_at
    FROM coin_grants
    WHERE remaining_coins > 0
        AND expires_at <= NOW()
    ORDER BY expires_at,
        id
    LIMIT sqlc.arg('batch')::integer
    FOR UPDATE SKIP LOCKED
),
zeroed AS (
    UPDATE coin_grants g
    SET remaining_coins = 0,
        updated_at = NOW()
    FROM lapsed
    WHERE g.id = lapsed.id
    RETURNING g.id
)
INSERT INTO coin_transactions (
        id,
        tenant_id,
        user_id,
        kind,
        coins,
        grant_id,
        created_at
    )
SELECT uuidv7(),
    lapsed.tenant_id,
    lapsed.user_id,
    'expiry',
    lapsed.remaining_coins,
    lapsed.id,
    lapsed.expires_at
FROM lapsed
    JOIN zeroed ON zeroed.id = lapsed.id
RETURNING tenant_id,
    grant_id,
    coins;

-- name: CreatePackCoinGrant :one
-- Grants the reader the coins a pack purchase bought, less what a shortfall
-- took of them as they were granted. A purchase grants once, so a grant made
-- already is no row.
INSERT INTO coin_grants (
        id,
        tenant_id,
        user_id,
        source,
        purchase_id,
        coins,
        remaining_coins,
        expires_at
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('user_id')::uuid,
        'pack_purchase',
        sqlc.arg('purchase_id')::uuid,
        sqlc.arg('coins'),
        sqlc.arg('remaining_coins'),
        sqlc.arg('expires_at')
    ) ON CONFLICT (tenant_id, purchase_id) DO NOTHING
RETURNING id;

-- name: GetCoinGrantOfPurchase :one
-- The grant a pack purchase made, and the reader it was made to, which a
-- revocation locks before it locks the grant.
SELECT id,
    user_id
FROM coin_grants
WHERE tenant_id = sqlc.arg('tenant_id')
    AND purchase_id = sqlc.arg('purchase_id')::uuid;

-- name: LockCoinGrant :one
-- A grant as a revocation reads it, locked against a spend drawing on it and
-- the expiry job zeroing it.
SELECT id,
    coins,
    remaining_coins,
    revoked_at
FROM coin_grants
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
FOR UPDATE;

-- name: CloseCoinGrant :exec
-- Takes back what a grant has left and records it closed.
UPDATE coin_grants
SET remaining_coins = 0,
    revoked_at = NOW(),
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');
