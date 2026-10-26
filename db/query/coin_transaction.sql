-- name: LockCoinSpendsOfUser :exec
-- Serializes, for the rest of the caller's transaction, the spends of one
-- reader, so a request sent twice and two payments of the same episode each
-- see what the other committed before they check what the reader holds.
SELECT pg_advisory_xact_lock(hashtextextended('coin-spend:' || sqlc.arg('tenant_id')::uuid::text || ':' || sqlc.arg('user_id')::uuid::text, 0));

-- name: GetCoinSpendByIdempotencyKey :one
-- The spend a reader's client already sent with the key, and what it paid for.
SELECT ct.id,
    ct.coins,
    ct.purchase_id::uuid AS purchase_id,
    p.episode_id::uuid AS episode_id,
    p.kind
FROM coin_transactions ct
    JOIN purchases p ON p.tenant_id = ct.tenant_id
    AND p.id = ct.purchase_id
WHERE ct.tenant_id = sqlc.arg('tenant_id')
    AND ct.user_id = sqlc.arg('user_id')::uuid
    AND ct.idempotency_key = sqlc.arg('idempotency_key')::text;

-- name: CreatePurchasePaidWithCoins :one
-- The purchase a spend of coins pays for. It names the spend as its checkout,
-- under the provider `coins`, so that what follows a purchase — the episode it
-- opens, its reading period, its revocation, the reader's purchase history,
-- the royalties on its sale — applies to it unchanged. No payment was taken,
-- so it has no payment id, and its price is what the coins it spent were
-- worth: the amounts of its spend's allocations added up.
INSERT INTO purchases (
        id,
        tenant_id,
        user_id,
        episode_id,
        price_at_purchase,
        expires_at,
        provider,
        provider_checkout_id,
        currency,
        kind
    )
VALUES (
        sqlc.arg('id')::uuid,
        sqlc.arg('tenant_id')::uuid,
        sqlc.arg('user_id')::uuid,
        sqlc.arg('episode_id')::uuid,
        sqlc.arg('price')::integer,
        sqlc.narg('expires_at')::timestamptz,
        'coins',
        sqlc.arg('spend_id')::uuid::text,
        sqlc.arg('currency')::text,
        sqlc.arg('kind')::text
    )
RETURNING *;

-- name: CreateCoinSpend :exec
INSERT INTO coin_transactions (
        id,
        tenant_id,
        user_id,
        kind,
        coins,
        purchase_id,
        idempotency_key
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('user_id')::uuid,
        'spend',
        sqlc.arg('coins'),
        sqlc.arg('purchase_id')::uuid,
        sqlc.arg('idempotency_key')::text
    );

-- name: CreateCoinSpendAllocation :exec
INSERT INTO coin_spend_allocations (
        tenant_id,
        transaction_id,
        grant_id,
        coins,
        amount
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('transaction_id'),
        sqlc.arg('grant_id'),
        sqlc.arg('coins'),
        sqlc.arg('amount')
    );

-- name: RefundCoinSpendsOfGrant :one
-- Records, on each purchase that coins of a grant paid for, the part of its
-- price those coins accounted for as refunded, once the grant has been closed
-- because its pack purchase was refunded or disputed. The reader keeps the
-- episodes the coins opened, so nothing is revoked, and a purchase whose coins
-- all came from the grant stays a sale whose whole price is refunded. A grant
-- is closed once, so its spends are refunded once. Answers what was refunded
-- in all.
WITH refunded AS (
    UPDATE purchases p
    SET refunded_amount = COALESCE(p.refunded_amount, 0) + a.amount
    FROM coin_spend_allocations a
        JOIN coin_transactions t ON t.tenant_id = a.tenant_id
        AND t.id = a.transaction_id
    WHERE a.tenant_id = sqlc.arg('tenant_id')
        AND a.grant_id = sqlc.arg('grant_id')
        AND a.amount > 0
        AND p.tenant_id = t.tenant_id
        AND p.id = t.purchase_id
    RETURNING a.amount
)
SELECT COALESCE(sum(amount), 0)::bigint AS refunded_amount
FROM refunded;

-- name: ListCoinTransactionsDesc :many
-- The reader's coin history, newest first. A spend names the episode of the
-- purchase it paid for, and whether the calling surface may show it, so the
-- history keeps every entry it sums to while a surface leaves out what it
-- cannot name.
SELECT ct.id,
    ct.kind,
    ct.coins,
    ct.created_at,
    g.expires_at AS grant_expires_at,
    -- A spend names the purchase it paid for, and an entry about a grant the
    -- pack purchase that made the grant.
    COALESCE(ct.purchase_id, g.purchase_id) AS purchase_id,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.order_index AS episode_order_index,
    -- Empty on an entry that is no spend, which joins no translation: sqlc
    -- reads the columns of a function's row as never NULL.
    COALESCE(et.title, '')::text AS episode_title,
    COALESCE(et.locale, '')::text AS episode_title_locale,
    s.id AS series_id,
    s.public_id AS series_public_id,
    COALESCE(str.title, '')::text AS series_title,
    COALESCE(str.locale, '')::text AS series_title_locale,
    EXISTS (
        SELECT 1
        FROM episode_surfaces es
        WHERE es.episode_id = e.id
            AND es.surface = sqlc.arg('surface')::text
    ) AS episode_shown
FROM coin_transactions ct
    LEFT JOIN coin_grants g ON g.tenant_id = ct.tenant_id
    AND g.id = ct.grant_id
    LEFT JOIN purchases p ON p.tenant_id = ct.tenant_id
    AND p.id = ct.purchase_id
    LEFT JOIN episodes e ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
    LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
    LEFT JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) str ON TRUE
WHERE ct.tenant_id = sqlc.arg('tenant_id')
    -- The cast keeps this a plain uuid: a deleted reader's NULL is nobody's history.
    AND ct.user_id = sqlc.arg('user_id')::uuid
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (ct.created_at, ct.id) <= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (ct.created_at, ct.id) < (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY ct.created_at DESC,
    ct.id DESC
LIMIT sqlc.arg('limit');

-- name: ListCoinTransactionsAsc :many
-- The same history oldest first, which a backward page is scanned in.
SELECT ct.id,
    ct.kind,
    ct.coins,
    ct.created_at,
    g.expires_at AS grant_expires_at,
    -- A spend names the purchase it paid for, and an entry about a grant the
    -- pack purchase that made the grant.
    COALESCE(ct.purchase_id, g.purchase_id) AS purchase_id,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.order_index AS episode_order_index,
    COALESCE(et.title, '')::text AS episode_title,
    COALESCE(et.locale, '')::text AS episode_title_locale,
    s.id AS series_id,
    s.public_id AS series_public_id,
    COALESCE(str.title, '')::text AS series_title,
    COALESCE(str.locale, '')::text AS series_title_locale,
    EXISTS (
        SELECT 1
        FROM episode_surfaces es
        WHERE es.episode_id = e.id
            AND es.surface = sqlc.arg('surface')::text
    ) AS episode_shown
FROM coin_transactions ct
    LEFT JOIN coin_grants g ON g.tenant_id = ct.tenant_id
    AND g.id = ct.grant_id
    LEFT JOIN purchases p ON p.tenant_id = ct.tenant_id
    AND p.id = ct.purchase_id
    LEFT JOIN episodes e ON e.tenant_id = p.tenant_id
    AND e.id = p.episode_id
    LEFT JOIN LATERAL episode_translation_for(e.id, sqlc.arg('locale')::text) et ON TRUE
    LEFT JOIN series s ON s.tenant_id = e.tenant_id
    AND s.id = e.series_id
    LEFT JOIN LATERAL series_translation_for(s.id, sqlc.arg('locale')::text) str ON TRUE
WHERE ct.tenant_id = sqlc.arg('tenant_id')
    AND ct.user_id = sqlc.arg('user_id')::uuid
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (ct.created_at, ct.id) >= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (ct.created_at, ct.id) > (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY ct.created_at ASC,
    ct.id ASC
LIMIT sqlc.arg('limit');

-- name: CreateCoinGrantTransaction :exec
-- Records an entry of the reader's history that is about one grant: the grant
-- itself, its revocation, the shortfall its revocation left, or the coins of
-- it a shortfall took. A grant has one entry of each kind, so recording one
-- again is a no-op.
INSERT INTO coin_transactions (
        id,
        tenant_id,
        user_id,
        kind,
        coins,
        grant_id
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.narg('user_id')::uuid,
        sqlc.arg('kind')::text,
        sqlc.arg('coins'),
        sqlc.arg('grant_id')::uuid
    ) ON CONFLICT (grant_id, kind) DO NOTHING;

-- name: GetExpiredCoinsOfGrant :one
-- The coins of a grant the expiry job recorded lapsed, 0 while it has
-- recorded none.
SELECT COALESCE(SUM(coins), 0)::integer
FROM coin_transactions
WHERE tenant_id = sqlc.arg('tenant_id')
    AND grant_id = sqlc.arg('grant_id')::uuid
    AND kind = 'expiry';

-- name: GetCoinShortfallOfUser :one
-- What the reader owes: the coins of every closed grant that had been spent,
-- less what later grants have paid of them.
SELECT COALESCE(SUM(
            CASE
                WHEN kind = 'shortfall' THEN coins
                ELSE -coins
            END
        ), 0)::bigint
FROM coin_transactions
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')::uuid
    AND kind IN ('shortfall', 'shortfall_settlement');
