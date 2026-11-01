-- name: OpenStoreSubscriptionIntent :one
-- Opens the reader's intent to subscribe to a plan as a store product, or
-- answers the one already open for the same plan and product, so asking again
-- adds no row. The no-op update is what makes the existing row come back.
INSERT INTO store_subscription_intents (
    id,
    tenant_id,
    user_id,
    plan_id,
    product_id
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('plan_id'),
    sqlc.arg('product_id')
)
ON CONFLICT (tenant_id, user_id, plan_id, product_id) WHERE consumed_at IS NULL DO
UPDATE
SET product_id = EXCLUDED.product_id
RETURNING *;

-- name: LockStoreSubscriptionIntent :one
-- Takes the intent a verified subscription names, holding it until the
-- subscription is written, so two confirmations of different subscriptions
-- cannot both consume it.
SELECT *
FROM store_subscription_intents
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
FOR UPDATE;

-- name: GetStoreSubscriptionIntentOwner :one
-- The reader an intent was opened by, read without its lock: a store's
-- notification learns from it whose subscriptions to lock before it takes the
-- intent's, the order an account deletion takes them in.
SELECT user_id
FROM store_subscription_intents
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: ConsumeStoreSubscriptionIntent :exec
UPDATE store_subscription_intents
SET consumed_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND consumed_at IS NULL;

-- name: LockStoreSubscription :exec
-- Serializes, for the rest of the caller's transaction, everything that writes
-- about one store subscription, so a read of it from the store and the write of
-- what was read are never split by another confirmation that read it later and
-- wrote first.
SELECT pg_advisory_xact_lock(
    hashtextextended(
        'store-subscription:' || sqlc.arg('tenant_id')::uuid::text || ':' ||
            sqlc.arg('provider')::text || ':' || sqlc.arg('store_subscription_id')::text,
        0
    )
);

-- name: GetStoreSubscription :one
-- The subscription a store's own ID is recorded as, whose it is, and the plan
-- it is recorded on.
SELECT id,
    user_id,
    plan_id
FROM subscriptions
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')::text
    AND store_subscription_id = sqlc.arg('store_subscription_id')::text;

-- name: MoveStoreSubscriptionToToken :exec
-- Moves a recorded subscription to the store ID of the subscription that
-- replaced it, as Google Play gives a change of plan a purchase token of its
-- own, so the reader keeps one subscription rather than gaining a second.
UPDATE subscriptions
SET store_subscription_id = sqlc.arg('store_subscription_id')::text,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: GetSubscriptionPlanForStoreProductForTenant :one
-- The plan a store product is sold as, published or not: a subscription the
-- store has charged for is recorded on its plan even after staff unpublished
-- it, as a Stripe one goes on after its plan is unpublished.
SELECT id
FROM subscription_plans
WHERE tenant_id = sqlc.arg('tenant_id')
    AND (
        (
            sqlc.arg('provider')::text = 'app_store'
            AND app_store_product_id = sqlc.arg('product_id')::text
        )
        OR (
            sqlc.arg('provider')::text = 'google_play'
            AND google_play_product_id = sqlc.arg('product_id')::text
        )
    );

-- name: RecordStoreSubscription :one
-- Writes a store subscription as the store reports it now. A subscription
-- already here takes the new state and keeps the reader it was recorded for,
-- as RecordSubscriptionFromStripe does; a reader whose account no longer
-- exists is recorded as NULL.
INSERT INTO subscriptions (
    id,
    tenant_id,
    user_id,
    plan_id,
    provider,
    store_subscription_id,
    store_product_id,
    is_test,
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
    sqlc.arg('provider')::text,
    sqlc.arg('store_subscription_id')::text,
    sqlc.arg('store_product_id')::text,
    sqlc.arg('is_test'),
    sqlc.arg('status'),
    sqlc.narg('current_period_end'),
    sqlc.arg('cancel_at_period_end')
)
ON CONFLICT (tenant_id, provider, store_subscription_id) DO
UPDATE
SET plan_id = EXCLUDED.plan_id,
    store_product_id = EXCLUDED.store_product_id,
    status = EXCLUDED.status,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    updated_at = NOW()
RETURNING id,
    user_id,
    plan_id,
    status;
