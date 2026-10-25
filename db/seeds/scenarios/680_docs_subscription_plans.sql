-- Scenario: the subscription plans the documentation's screenshots show
--
-- The page under docs/<locale>/4-console/ about subscription plans explains
-- the console's list of plans and a plan's edit screen, and the tenant of
-- 670_storefront_subscriptions.sql, which has to be applied first, holds one
-- published plan nobody pays for. This file adds two plans beside it: one of
-- the whole catalog, which the tenant's reader holds an active subscription
-- to, and an unpublished yearly plan of the same label, so the list shows
-- every scope, both states, and a subscriber. Their Prices are placeholders:
-- neither screen asks Stripe for anything.
--
-- The subscription runs out years ahead, so the plan counts its subscriber on
-- every run.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts. The subscriptions
-- suite applies 670_storefront_subscriptions.sql again before it runs, which
-- deletes the tenant and everything this file wrote with it, and the file
-- deletes its own rows before writing them, so it can be applied any number
-- of times.
--
-- ID band: 018f11b0-0001-7000-8000-0000000000NN for the plans, and -0002- for
-- the subscription.

BEGIN;

DELETE FROM subscriptions
WHERE id = '018f11b0-0002-7000-8000-000000000001'::uuid;

DELETE FROM subscription_plans
WHERE id IN (
    '018f11b0-0001-7000-8000-000000000001'::uuid,
    '018f11b0-0001-7000-8000-000000000002'::uuid
);

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
SELECT
    p.id,
    t.id,
    p.public_id,
    p.name,
    p.description,
    p.stripe_price_id,
    p.price_amount,
    'JPY',
    p.recurring_interval,
    1,
    p.scope,
    p.is_published
FROM tenants t
CROSS JOIN (
    VALUES
        (
            '018f11b0-0001-7000-8000-000000000001'::uuid,
            'DsubPLANAAA1',
            'All-access pass',
            'Every episode on the site, every month.',
            'price_1QAllAccessMonthly',
            1500,
            'month',
            'all',
            true
        ),
        (
            '018f11b0-0001-7000-8000-000000000002'::uuid,
            'DsubPLANAAA2',
            'Night pass, yearly',
            'Every episode of the Night Label, paid once a year.',
            'price_1QNightPassYearly',
            9800,
            'year',
            'label',
            false
        )
) AS p(
    id,
    public_id,
    name,
    description,
    stripe_price_id,
    price_amount,
    recurring_interval,
    scope,
    is_published
)
WHERE t.public_id = 'SbsfTNNTAAA1';

INSERT INTO subscription_plan_targets (tenant_id, plan_id, label_id)
SELECT
    p.tenant_id,
    p.id,
    l.id
FROM subscription_plans p
JOIN labels l ON l.tenant_id = p.tenant_id AND l.public_id = 'SbsfLABLAAA1'
WHERE p.id = '018f11b0-0001-7000-8000-000000000002'::uuid;

INSERT INTO subscriptions (
    id,
    tenant_id,
    user_id,
    plan_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_price_id,
    status,
    current_period_end
)
SELECT
    '018f11b0-0002-7000-8000-000000000001'::uuid,
    p.tenant_id,
    u.id,
    p.id,
    'cus_docs_subscription_plans',
    'sub_docs_subscription_plans',
    p.stripe_price_id,
    'active',
    '2036-01-01T00:00:00Z'::timestamptz
FROM subscription_plans p
JOIN users u ON u.tenant_id = p.tenant_id AND u.public_id = 'SbsfMMBRAAA1'
WHERE p.id = '018f11b0-0001-7000-8000-000000000001'::uuid;

COMMIT;
