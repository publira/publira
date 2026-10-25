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
-- one that expires first first. Locked for the draws that follow.
SELECT id,
    remaining_coins
FROM coin_grants
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')::uuid
    AND remaining_coins > 0
    AND expires_at > NOW()
ORDER BY expires_at,
    id
FOR UPDATE;

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
