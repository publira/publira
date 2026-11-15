-- name: LockPaymentRefund :exec
-- Holds, for the rest of the caller's transaction, the one refund of a payment
-- that may be at its provider, so that a refund of the same payment from any
-- other process waits until this one has been answered.
SELECT pg_advisory_xact_lock(hashtextextended(
    'payment-refund:' || sqlc.arg('tenant_id')::uuid::text || ':' || sqlc.arg('provider')::text || ':' || sqlc.arg('payment_id')::text,
    0
));
