-- name: RecordPaymentCheckout :exec
-- A retried request names the same checkout with the same purchase, so the
-- row already there is kept, and only when it was last started moves.
INSERT INTO payment_checkouts (
    tenant_id,
    provider,
    checkout_id,
    purchase
)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('provider'),
    sqlc.arg('checkout_id'),
    sqlc.arg('purchase')
)
ON CONFLICT (tenant_id, provider, checkout_id) DO UPDATE
SET last_started_at = now();

-- name: GetPaymentCheckoutPurchase :one
SELECT purchase
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND checkout_id = sqlc.arg('checkout_id');

-- name: ListPaymentCheckoutIDs :many
-- The checkouts first started before started_to and last started at or after
-- started_from, which are every checkout started in between, however many
-- times a request started it.
SELECT checkout_id
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND last_started_at >= sqlc.arg('started_from')
    AND created_at < sqlc.arg('started_to')
ORDER BY created_at, checkout_id;
