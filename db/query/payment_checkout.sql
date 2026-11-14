-- name: RecordPaymentCheckout :exec
-- A retried request names the same checkout with the same purchase, so the
-- row already there is kept.
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
ON CONFLICT (tenant_id, provider, checkout_id) DO NOTHING;

-- name: GetPaymentCheckoutPurchase :one
SELECT purchase
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND checkout_id = sqlc.arg('checkout_id');

-- name: ListPaymentCheckoutIDs :many
SELECT checkout_id
FROM payment_checkouts
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND created_at >= sqlc.arg('created_from')
    AND created_at < sqlc.arg('created_to')
ORDER BY created_at, checkout_id;
