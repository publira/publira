-- name: ListSubscriptionPlansForTenant :many
-- Every plan of the tenant, in the order they were created, with how many
-- readers hold a subscription to it that is trialing, active, or past due. The
-- admin API caps how many plans a tenant holds, so the list is read whole.
SELECT sp.id,
    sp.public_id,
    sp.name,
    sp.description,
    sp.stripe_price_id,
    sp.price_amount,
    sp.currency,
    sp.recurring_interval,
    sp.recurring_interval_count,
    sp.scope,
    sp.is_published,
    sp.created_at,
    sp.updated_at,
    (
        SELECT COUNT(*)::int4
        FROM subscriptions s
        WHERE s.tenant_id = sp.tenant_id
            AND s.plan_id = sp.id
            AND s.status IN ('trialing', 'active', 'past_due')
    ) AS subscriber_count
FROM subscription_plans sp
WHERE sp.tenant_id = $1
ORDER BY sp.created_at ASC,
    sp.id ASC;

-- name: GetSubscriptionPlanByIDForTenant :one
SELECT sp.id,
    sp.public_id,
    sp.name,
    sp.description,
    sp.stripe_price_id,
    sp.price_amount,
    sp.currency,
    sp.recurring_interval,
    sp.recurring_interval_count,
    sp.scope,
    sp.is_published,
    sp.created_at,
    sp.updated_at,
    (
        SELECT COUNT(*)::int4
        FROM subscriptions s
        WHERE s.tenant_id = sp.tenant_id
            AND s.plan_id = sp.id
            AND s.status IN ('trialing', 'active', 'past_due')
    ) AS subscriber_count
FROM subscription_plans sp
WHERE sp.tenant_id = $1
    AND sp.id = $2
LIMIT 1;

-- name: ListPublishedSubscriptionPlansForTenant :many
SELECT id,
    public_id,
    name,
    description,
    price_amount,
    currency,
    recurring_interval,
    recurring_interval_count,
    scope
FROM subscription_plans
WHERE tenant_id = $1
    AND is_published
ORDER BY created_at ASC,
    id ASC;

-- name: GetPublishedSubscriptionPlanByIDForTenant :one
SELECT id,
    public_id,
    name,
    description,
    stripe_price_id,
    price_amount,
    currency,
    recurring_interval,
    recurring_interval_count,
    scope
FROM subscription_plans
WHERE tenant_id = $1
    AND id = $2
    AND is_published
LIMIT 1;

-- name: GetSubscriptionPlanForSubscriptionForTenant :one
-- The plan a subscription is recorded on: the one billed at the Price Stripe
-- reports, which follows a reader who changed their Price in the billing
-- portal, else the one the checkout named.
SELECT id
FROM subscription_plans
WHERE tenant_id = sqlc.arg('tenant_id')
    AND (
        stripe_price_id = sqlc.arg('stripe_price_id')
        OR id = sqlc.arg('plan_id')
    )
ORDER BY (stripe_price_id = sqlc.arg('stripe_price_id')) DESC
LIMIT 1;

-- name: LockTenantForSubscriptionPlans :one
-- Serializes the creates of one tenant, so two of them cannot both count one
-- short of the cap and both be stored. NO KEY UPDATE rather than UPDATE, so it
-- does not hold back the foreign key checks every write naming the tenant
-- makes.
SELECT id
FROM tenants
WHERE id = $1
FOR NO KEY UPDATE;

-- name: CountSubscriptionPlansForTenant :one
SELECT COUNT(*)::int4 AS plan_count
FROM subscription_plans
WHERE tenant_id = $1;

-- name: CreateSubscriptionPlan :one
INSERT INTO subscription_plans (
        id,
        tenant_id,
        public_id,
        name,
        description,
        stripe_price_id,
        price_amount,
        currency,
        recurring_interval,
        recurring_interval_count,
        scope,
        is_published
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('public_id'),
        sqlc.arg('name'),
        sqlc.arg('description'),
        sqlc.arg('stripe_price_id'),
        sqlc.arg('price_amount'),
        sqlc.arg('currency'),
        sqlc.arg('recurring_interval'),
        sqlc.arg('recurring_interval_count'),
        sqlc.arg('scope'),
        sqlc.arg('is_published')
    )
RETURNING id,
    public_id;

-- name: UpdateSubscriptionPlan :execrows
UPDATE subscription_plans
SET name = sqlc.arg('name'),
    description = sqlc.arg('description'),
    stripe_price_id = sqlc.arg('stripe_price_id'),
    price_amount = sqlc.arg('price_amount'),
    currency = sqlc.arg('currency'),
    recurring_interval = sqlc.arg('recurring_interval'),
    recurring_interval_count = sqlc.arg('recurring_interval_count'),
    scope = sqlc.arg('scope'),
    is_published = sqlc.arg('is_published'),
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: DeleteSubscriptionPlan :execrows
DELETE FROM subscription_plans
WHERE tenant_id = $1
    AND id = $2;

-- name: CountSubscriptionsAndCheckoutsForPlan :one
-- Every subscription the plan bills or billed, whatever its state, and every
-- reader whose latest checkout was of it.
SELECT (
        SELECT COUNT(*)
        FROM subscriptions s
        WHERE s.tenant_id = sqlc.arg('tenant_id')
            AND s.plan_id = sqlc.arg('plan_id')
    )::int4 + (
        SELECT COUNT(*)
        FROM subscription_checkouts c
        WHERE c.tenant_id = sqlc.arg('tenant_id')
            AND c.plan_id = sqlc.arg('plan_id')
    )::int4 AS subscription_count;

-- name: ListSubscriptionPlanTargetsForTenant :many
-- The labels and series the plans name, each row one of the two.
SELECT plan_id,
    label_id,
    series_id
FROM subscription_plan_targets
WHERE tenant_id = sqlc.arg('tenant_id')
    AND plan_id = ANY(sqlc.arg('plan_ids')::uuid[])
ORDER BY plan_id,
    label_id,
    series_id;

-- name: DeleteSubscriptionPlanTargets :exec
DELETE FROM subscription_plan_targets
WHERE tenant_id = $1
    AND plan_id = $2;

-- name: CreateSubscriptionPlanLabelTargets :exec
INSERT INTO subscription_plan_targets (tenant_id, plan_id, label_id)
SELECT sqlc.arg('tenant_id'),
    sqlc.arg('plan_id'),
    UNNEST(sqlc.arg('label_ids')::uuid[]);

-- name: CreateSubscriptionPlanSeriesTargets :exec
INSERT INTO subscription_plan_targets (tenant_id, plan_id, series_id)
SELECT sqlc.arg('tenant_id'),
    sqlc.arg('plan_id'),
    UNNEST(sqlc.arg('series_ids')::uuid[]);

-- name: CountLabelsForSubscriptionPlan :one
-- How many of the labels a plan is saved with belong to the tenant.
SELECT COUNT(*)::int4 AS label_count
FROM labels
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = ANY(sqlc.arg('ids')::uuid[]);

-- name: CountSeriesForSubscriptionPlan :one
-- How many of the series a plan is saved with belong to the tenant.
SELECT COUNT(*)::int4 AS series_count
FROM series
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = ANY(sqlc.arg('ids')::uuid[]);
