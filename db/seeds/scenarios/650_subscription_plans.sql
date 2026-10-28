-- Scenario: a tenant whose subscription plans the console creates and edits
--
-- `admin.subscription-plans.spec.ts` takes the tenant's payments through
-- Stripe from `/integrations/payment`, which a plan's Price is read through,
-- creates a plan of the label below at `/subscription-plans`, edits and
-- unpublishes it, and deletes it, and is refused deleting the plan a reader
-- already subscribed to. Both the payment settings and the plans are the
-- tenant's own, so no tenant another suite reads can absorb them.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes its payment settings and the plans the suite
-- created with it. Subscriptions restrict the delete of their plan, and sales
-- and the catalog the deletes that would reach them from the tenant, so they
-- go first.
-- public_id values are hard-coded in e2e/src/scenarios/subscription-plans.ts.
--   tenant  SubpTNNTAAA1 (plans.localhost / admin.plans.localhost)
--   admin   SubpADMNAAA1 (plans-admin@example.com)
--   reader  SubpMMBRAAA1 (Plans Subscriber), who holds the plan below
--   label   SubpLABLAAA1 (Plans Label 01), series SubpSERSAAA1 under it
--   plan    SubpPLANAAA1 (Seeded monthly pass), opening the whole catalog

DELETE FROM subscriptions
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SubpTNNTAAA1');

DELETE FROM subscription_checkouts
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SubpTNNTAAA1');

DELETE FROM subscription_plans
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SubpTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SubpTNNTAAA1');

DELETE FROM labels
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SubpTNNTAAA1');

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SubpTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'SubpTNNTAAA1';

INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale,
    supported_locales
)
VALUES (
    '018f1190-0001-7000-8000-000000000001'::uuid,
    'SubpTNNTAAA1',
    'plans.localhost:' || :'tenant_port',
    'admin.plans.localhost:' || :'tenant_port',
    'Subscription Plans Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant SubpTNNTAAA1
\ir ../creator_roles.sql

-- The admin and the reader. The password hash is the same as `adminpass` for
-- the admin and `memberpass` for the reader.
INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    email_verified_at
)
SELECT
    u.id,
    t.id,
    u.public_id,
    u.email,
    u.password_hash,
    u.name,
    'active',
    NOW()
FROM tenants t
CROSS JOIN (
    VALUES
        (
            '018f1190-0002-7000-8000-000000000001'::uuid,
            'SubpADMNAAA1',
            'plans-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Plans E2E Admin'
        ),
        (
            '018f1190-0002-7000-8000-000000000002'::uuid,
            'SubpMMBRAAA1',
            'plans-subscriber@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Plans Subscriber'
        )
) AS u(id, public_id, email, password_hash, name)
WHERE t.public_id = 'SubpTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1190-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'SubpADMNAAA1';

INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f1190-0004-7000-8000-000000000001'::uuid,
    t.id,
    'SubpLABLAAA1',
    'Plans Label 01'
FROM tenants t
WHERE t.public_id = 'SubpTNNTAAA1';

INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    '018f1190-0005-7000-8000-000000000001'::uuid,
    l.tenant_id,
    l.id,
    'SubpSERSAAA1',
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM labels l
WHERE l.public_id = 'SubpLABLAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f1190-0006-7000-8000-000000000001'::uuid,
    s.id,
    s.tenant_id,
    t.default_locale,
    'Plans Series 001',
    ''
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE s.public_id = 'SubpSERSAAA1';

-- A plan of the whole catalog that the reader already pays for every month,
-- which the console counts as one subscriber and refuses to delete.
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
    '018f1190-0007-7000-8000-000000000001'::uuid,
    t.id,
    'SubpPLANAAA1',
    'Seeded monthly pass',
    '',
    'price_subscription_plans_e2e_seeded',
    980,
    'JPY',
    'month',
    1,
    'all',
    true
FROM tenants t
WHERE t.public_id = 'SubpTNNTAAA1';

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
    '018f1190-0008-7000-8000-000000000001'::uuid,
    p.tenant_id,
    u.id,
    p.id,
    'cus_subscription_plans_e2e',
    'sub_subscription_plans_e2e',
    p.stripe_price_id,
    'active',
    NOW() + INTERVAL '30 days'
FROM subscription_plans p
JOIN users u ON u.tenant_id = p.tenant_id AND u.public_id = 'SubpMMBRAAA1'
WHERE p.public_id = 'SubpPLANAAA1';
