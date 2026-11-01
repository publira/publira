-- name: LockProviderPayment :exec
-- Serializes the writes about one payment of a provider for the rest of the
-- transaction: recording a subscription payment and applying the refund or the
-- dispute held for it, against matching a refund or a dispute to it or holding
-- one. Without it, one matched while the payment's insert is uncommitted finds
-- nothing and is held, and the insert finds nothing held, so it is never
-- applied.
SELECT pg_advisory_xact_lock(hashtextextended(
    'provider-payment:' || sqlc.arg('tenant_id')::uuid::text || ':' || sqlc.arg('provider')::text || ':' || sqlc.arg('provider_payment_id')::text,
    0
));

-- name: RecordSubscriptionPayment :one
-- Records an invoice Stripe reports paid, on the subscription and the plan it
-- is recorded on. A redelivered notification of the same invoice matches the
-- row already here and records nothing, which the caller reads as an empty
-- result.
INSERT INTO subscription_payments (
    id,
    tenant_id,
    subscription_id,
    plan_id,
    stripe_invoice_id,
    stripe_payment_intent_id,
    amount,
    currency,
    period_start,
    period_end,
    paid_at,
    is_test
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('subscription_id'),
    sqlc.arg('plan_id'),
    sqlc.arg('stripe_invoice_id'),
    sqlc.narg('stripe_payment_intent_id'),
    sqlc.arg('amount'),
    sqlc.arg('currency'),
    sqlc.arg('period_start'),
    sqlc.arg('period_end'),
    sqlc.arg('paid_at'),
    sqlc.arg('is_test')
)
ON CONFLICT (tenant_id, stripe_invoice_id) DO NOTHING
RETURNING *;

-- name: RecordRefundOnSubscriptionPayment :one
-- Records what Stripe has refunded against one subscription payment, matched
-- by the PaymentIntent the refund notification names, by the rules
-- RecordRefundOnPurchase applies to a purchase: the total only grows, and one
-- reported with no amount or in another currency than the payment's is a
-- refund of all of it. Nothing matches a PaymentIntent no payment here was
-- paid through.
UPDATE subscription_payments sp
SET refunded_amount = LEAST(
        sp.amount,
        GREATEST(
            COALESCE(sp.refunded_amount, 0),
            COALESCE(
                CASE
                    WHEN sqlc.narg('currency')::text = sp.currency THEN sqlc.narg('refunded_amount')::integer
                END,
                sp.amount
            )
        )
    )
WHERE sp.tenant_id = sqlc.arg('tenant_id')
    AND sp.stripe_payment_intent_id = sqlc.arg('stripe_payment_intent_id')::text
RETURNING sp.*;

-- name: RecordFailedRefundOnSubscriptionPayment :one
-- Records that a refund of a subscription payment failed after Stripe
-- accepted it, taking the total that stays refunded from Stripe as it now
-- stands, the one place a recorded amount goes down. Nothing matches a
-- PaymentIntent no payment here was paid through, or a total in a currency
-- other than the payment's.
UPDATE subscription_payments sp
SET refunded_amount = LEAST(sp.amount, sqlc.arg('refunded_amount')::integer)
WHERE sp.tenant_id = sqlc.arg('tenant_id')
    AND sp.stripe_payment_intent_id = sqlc.arg('stripe_payment_intent_id')::text
    AND sp.currency = sqlc.arg('currency')::text
RETURNING sp.*;

-- name: ApplyUnappliedRefundToSubscriptionPayment :one
-- Writes a refund held because its notification overtook the payment's onto
-- the payment, by the rules RecordRefundOnSubscriptionPayment uses. Nothing
-- matches when no refund is held for the PaymentIntent, which is the ordinary
-- case. The held row is left for the caller to release once this has
-- committed, as ApplyUnappliedRefundToPurchase leaves it.
WITH held AS (
    SELECT r.refunded_amount,
        r.currency
    FROM unapplied_refunds r
    WHERE r.tenant_id = sqlc.arg('tenant_id')
        AND r.provider = sqlc.arg('provider')::text
        AND r.provider_payment_id = sqlc.arg('stripe_payment_intent_id')::text
)
UPDATE subscription_payments sp
SET refunded_amount = LEAST(
        sp.amount,
        GREATEST(
            COALESCE(sp.refunded_amount, 0),
            COALESCE(
                CASE
                    WHEN held.currency = sp.currency THEN held.refunded_amount
                END,
                sp.amount
            )
        )
    )
FROM held
WHERE sp.tenant_id = sqlc.arg('tenant_id')
    AND sp.stripe_payment_intent_id = sqlc.arg('stripe_payment_intent_id')::text
RETURNING sp.*;

-- name: GetSubscriptionPaymentIDByPaymentIntent :one
-- The subscription payment paid through a PaymentIntent. No row is a
-- PaymentIntent no payment here was paid through, which is an open dispute
-- the caller holds until the payment is recorded.
SELECT id
FROM subscription_payments
WHERE tenant_id = sqlc.arg('tenant_id')
    AND stripe_payment_intent_id = sqlc.arg('stripe_payment_intent_id')::text;

-- name: RecordLostDisputeOnSubscriptionPayment :one
-- Records that the dispute of the subscription payment was lost: the reader's
-- bank has returned the money, so the payment counts as refunded in full and
-- is no longer a sale on a royalty statement. A repeated delivery leaves the
-- instant already stored. Nothing matches a PaymentIntent no payment here was
-- paid through. The subscription itself is left as Stripe holds it.
UPDATE subscription_payments
SET dispute_lost_at = COALESCE(dispute_lost_at, NOW())
WHERE tenant_id = sqlc.arg('tenant_id')
    AND stripe_payment_intent_id = sqlc.arg('stripe_payment_intent_id')::text
RETURNING *;

-- name: ApplyUnappliedDisputeToSubscriptionPayment :one
-- Writes a dispute held because its notification overtook the payment's onto
-- the payment. Held as lost, it sets dispute_lost_at from that instant, by
-- the rule RecordLostDisputeOnSubscriptionPayment uses; held open, it changes
-- the payment not at all. Nothing matches when no dispute is held, which is
-- the ordinary case. The held row is deleted by the caller in the same
-- transaction.
UPDATE subscription_payments sp
SET dispute_lost_at = COALESCE(sp.dispute_lost_at, d.lost_at)
FROM unapplied_disputes d
WHERE d.tenant_id = sp.tenant_id
    AND d.provider = sqlc.arg('provider')::text
    AND d.provider_payment_id = sp.stripe_payment_intent_id
    AND sp.tenant_id = sqlc.arg('tenant_id')
    AND sp.stripe_payment_intent_id = sqlc.arg('stripe_payment_intent_id')::text
RETURNING sp.*;
