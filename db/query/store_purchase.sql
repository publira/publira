-- name: OpenStorePurchaseIntent :one
-- Opens the reader's intent to buy an episode as a store product, or answers
-- the one already open for the same episode and product, so asking again adds
-- no row. The no-op update is what makes the existing row come back, with the
-- terms it was first opened on.
INSERT INTO store_purchase_intents (
    id,
    tenant_id,
    user_id,
    episode_id,
    price,
    product_id,
    reading_period_hours
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('episode_id'),
    sqlc.arg('price'),
    sqlc.arg('product_id'),
    sqlc.narg('reading_period_hours')
)
ON CONFLICT (tenant_id, user_id, episode_id, product_id) WHERE consumed_at IS NULL DO
UPDATE
SET product_id = EXCLUDED.product_id
RETURNING *;

-- name: LockStorePurchaseIntent :one
-- Takes the intent a verified transaction names, holding it until the purchase
-- it becomes is written, so two confirmations of different transactions
-- cannot both consume it.
SELECT *
FROM store_purchase_intents
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
FOR UPDATE;

-- name: ConsumeStorePurchaseIntent :exec
UPDATE store_purchase_intents
SET consumed_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND consumed_at IS NULL;

-- name: GetStorePurchaseByTransaction :one
SELECT *
FROM purchases
WHERE tenant_id = sqlc.arg('tenant_id')
    AND store = sqlc.arg('store')::text
    AND store_transaction_id = sqlc.arg('store_transaction_id')::text;

-- name: CreateStorePurchase :one
-- Records a verified store transaction. A transaction is sold once, so a
-- second insert of the same one is no row and the caller reads the first.
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    price_at_purchase,
    expires_at,
    store,
    store_transaction_id,
    is_test
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id')::uuid,
    sqlc.arg('episode_id'),
    sqlc.arg('price_at_purchase'),
    sqlc.narg('expires_at'),
    sqlc.arg('store')::text,
    sqlc.arg('store_transaction_id')::text,
    sqlc.arg('is_test')
)
ON CONFLICT (tenant_id, store, store_transaction_id) DO NOTHING
RETURNING *;

-- name: GetMyPurchase :one
-- One purchase of the reader's, shaped as the library lists it.
SELECT p.id,
    p.price_at_purchase,
    p.expires_at,
    p.refunded_at,
    p.purchased_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    e.order_index AS episode_order_index,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM purchases p
    JOIN episodes e ON e.tenant_id = p.tenant_id AND e.id = p.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id AND s.id = e.series_id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND p.user_id = sqlc.arg('user_id')::uuid
    AND p.id = sqlc.arg('id');

-- name: RecordStoreRefundOnPurchase :one
-- Records a store's refund on the purchase of the transaction it names. A
-- store refunds a consumable in full, so the purchase is refunded its whole
-- price; a repeated notification or poll leaves the instant already stored.
-- Nothing matches when the transaction has no purchase here yet.
UPDATE purchases
SET refunded_amount = price_at_purchase,
    refunded_at = COALESCE(refunded_at, NOW())
WHERE tenant_id = sqlc.arg('tenant_id')
    AND store = sqlc.arg('store')::text
    AND store_transaction_id = sqlc.arg('store_transaction_id')::text
RETURNING *;

-- name: HoldUnappliedStoreRefund :exec
INSERT INTO unapplied_store_refunds (
    tenant_id,
    store,
    store_transaction_id
)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('store')::text,
    sqlc.arg('store_transaction_id')::text
)
ON CONFLICT (tenant_id, store, store_transaction_id) DO
UPDATE
SET received_at = NOW();

-- name: ApplyUnappliedStoreRefundToPurchase :one
-- Writes a held refund onto the purchase that has since been recorded. Nothing
-- matches when no refund is held for the transaction, which is the ordinary
-- case. The held row is deleted by the caller in the same transaction.
UPDATE purchases p
SET refunded_amount = p.price_at_purchase,
    refunded_at = COALESCE(p.refunded_at, NOW())
FROM unapplied_store_refunds r
WHERE r.tenant_id = p.tenant_id
    AND r.store = p.store
    AND r.store_transaction_id = p.store_transaction_id
    AND p.tenant_id = sqlc.arg('tenant_id')
    AND p.id = sqlc.arg('purchase_id')
RETURNING p.*;

-- name: ReleaseUnappliedStoreRefund :exec
DELETE FROM unapplied_store_refunds
WHERE tenant_id = sqlc.arg('tenant_id')
    AND store = sqlc.arg('store')::text
    AND store_transaction_id = sqlc.arg('store_transaction_id')::text;
