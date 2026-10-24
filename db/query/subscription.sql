-- name: RecordSubscriptionFromStripe :one
-- Writes a subscription as Stripe reports it now. A subscription already here
-- takes the new state, and keeps the reader it was recorded for: the account
-- may have been deleted since, which leaves user_id NULL rather than naming
-- whoever the metadata says. A reader whose account no longer exists is
-- recorded as NULL too.
INSERT INTO subscriptions (
        id,
        tenant_id,
        user_id,
        plan_id,
        stripe_customer_id,
        stripe_subscription_id,
        status,
        current_period_end,
        cancel_at_period_end
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        (
            SELECT u.id
            FROM users u
            WHERE u.tenant_id = sqlc.arg('tenant_id')
                AND u.id = sqlc.arg('user_id')
        ),
        sqlc.arg('plan_id'),
        sqlc.arg('stripe_customer_id'),
        sqlc.arg('stripe_subscription_id'),
        sqlc.arg('status'),
        sqlc.narg('current_period_end'),
        sqlc.arg('cancel_at_period_end')
    ) ON CONFLICT (tenant_id, stripe_subscription_id) DO
UPDATE
SET plan_id = EXCLUDED.plan_id,
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    updated_at = NOW()
RETURNING id,
    user_id,
    plan_id,
    status;

-- name: GetMySubscription :one
-- The reader's latest subscription that is not over, or failing that the
-- latest one that is.
SELECT s.id,
    s.plan_id,
    s.status,
    s.current_period_end,
    s.cancel_at_period_end,
    s.created_at
FROM subscriptions s
WHERE s.tenant_id = $1
    AND s.user_id = $2
ORDER BY (s.status IN ('canceled', 'incomplete_expired')) ASC,
    s.updated_at DESC,
    s.id DESC
LIMIT 1;

-- name: UserHoldsLiveSubscription :one
-- Whether the reader holds a subscription Stripe will go on billing, which a
-- second checkout would run beside. An incomplete one is not among them:
-- Stripe drops it within a day unless its first payment goes through, and a
-- reader whose payment failed starts again.
SELECT EXISTS (
        SELECT 1
        FROM subscriptions
        WHERE tenant_id = $1
            AND user_id = $2
            AND status IN ('trialing', 'active', 'past_due', 'unpaid', 'paused')
    ) AS holds;

-- name: GetLatestStripeCustomerIDForUser :one
-- The Stripe customer the reader last subscribed as, which a later checkout
-- and the billing portal name, so the reader's invoices stay on one customer.
SELECT stripe_customer_id
FROM subscriptions
WHERE tenant_id = $1
    AND user_id = $2
ORDER BY created_at DESC,
    id DESC
LIMIT 1;

-- name: GetLatestSubscriptionIDForUser :one
-- The reader's latest subscription, which a checkout's idempotency key names
-- so that subscribing again after one ends starts a new checkout.
SELECT stripe_subscription_id
FROM subscriptions
WHERE tenant_id = $1
    AND user_id = $2
ORDER BY created_at DESC,
    id DESC
LIMIT 1;
