-- Scenario: a tenant whose purchases the console lists and refunds
--
-- `admin.purchases.spec.ts` narrows this tenant's purchases at `/purchases`,
-- opens each in the detail drawer, and takes payments through Stripe from
-- `/integrations/payment` so that the Stripe purchase can be refunded. Which
-- purchase is refundable depends on the tenant's payment settings, so no
-- tenant another suite reads can absorb them.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes its payment settings with it. Sales and the
-- catalog restrict the deletes that would reach them from the tenant, so they
-- go first.
-- public_id values are hard-coded in e2e/src/scenarios/purchases.ts.
--   tenant   PrchTNNTAAA1 (purchases.localhost / admin.purchases.localhost)
--   admin    PrchADMNAAA1 (purchases-admin@example.com)
--   readers  PrchMMBRAAA1 (Purchase Buyer One), PrchMMBRAAA2 (Purchase Buyer Two)
--   series   PrchSERSAAA1, episodes PrchEPSDAAA1 and PrchEPSDAAA2 (500 yen)

DELETE FROM purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrchTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrchTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrchTNNTAAA1');

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrchTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'PrchTNNTAAA1';

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
    '018f10d0-0001-7000-8000-000000000001'::uuid,
    'PrchTNNTAAA1',
    'purchases.localhost:' || :'tenant_port',
    'admin.purchases.localhost:' || :'tenant_port',
    'Purchases Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant PrchTNNTAAA1
\ir ../creator_roles.sql

-- The admin and the two readers. The password hash is the same as `adminpass`
-- for the admin and `memberpass` for the readers.
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
            '018f10d0-0002-7000-8000-000000000001'::uuid,
            'PrchADMNAAA1',
            'purchases-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Purchases E2E Admin'
        ),
        (
            '018f10d0-0002-7000-8000-000000000002'::uuid,
            'PrchMMBRAAA1',
            'purchase-buyer-one@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Purchase Buyer One'
        ),
        (
            '018f10d0-0002-7000-8000-000000000003'::uuid,
            'PrchMMBRAAA2',
            'purchase-buyer-two@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Purchase Buyer Two'
        )
) AS u(id, public_id, email, password_hash, name)
WHERE t.public_id = 'PrchTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f10d0-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'PrchADMNAAA1';

INSERT INTO series (id, tenant_id, public_id, is_published, published_at)
SELECT
    '018f10d0-0004-7000-8000-000000000001'::uuid,
    t.id,
    'PrchSERSAAA1',
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'PrchTNNTAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f10d0-0007-7000-8000-000000000001'::uuid,
    s.id,
    s.tenant_id,
    t.default_locale,
    'Purchase Series 001',
    ''
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE s.public_id = 'PrchSERSAAA1';

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    e.id,
    s.id,
    e.public_id,
    e.order_index,
    s.tenant_id
FROM series s
CROSS JOIN (
    VALUES
        ('018f10d0-0005-7000-8000-000000000001'::uuid, 'PrchEPSDAAA1', 1),
        ('018f10d0-0005-7000-8000-000000000002'::uuid, 'PrchEPSDAAA2', 2)
) AS e(id, public_id, order_index)
WHERE s.public_id = 'PrchSERSAAA1';

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    tr.id,
    e.id,
    e.tenant_id,
    t.default_locale,
    tr.title
FROM (
    VALUES
        ('018f10d0-0008-7000-8000-000000000001'::uuid, 'PrchEPSDAAA1', 'Purchase Episode 001-01'),
        ('018f10d0-0008-7000-8000-000000000002'::uuid, 'PrchEPSDAAA2', 'Purchase Episode 001-02')
) AS tr(id, episode_public_id, title)
JOIN episodes e ON e.public_id = tr.episode_public_id
JOIN tenants t ON t.id = e.tenant_id;

INSERT INTO episode_listings (episode_id, price, status, published_at, tenant_id)
SELECT
    e.id,
    500,
    'published',
    '2026-01-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
WHERE e.public_id IN ('PrchEPSDAAA1', 'PrchEPSDAAA2');

-- Three purchases, newest first in the console:
--   1. Buyer One paid for episode 01 through Stripe, which the tenant's
--      Stripe settings make refundable.
--   2. Buyer Two bought episode 02 in the app through Google Play, which is
--      refunded by the store and never from the console.
--   3. Buyer Two paid for episode 01 through Stripe and was refunded in full
--      in the Stripe Dashboard.
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    price_at_purchase,
    currency,
    purchased_at,
    provider,
    provider_checkout_id,
    provider_payment_id,
    store,
    store_transaction_id,
    refunded_amount,
    refunded_at,
    revoked_at,
    revocation_reason
)
SELECT
    p.id,
    u.tenant_id,
    u.id,
    e.id,
    500,
    'JPY',
    p.purchased_at,
    p.provider,
    p.provider_checkout_id,
    p.provider_payment_id,
    p.store,
    p.store_transaction_id,
    p.refunded_amount,
    p.refunded_at,
    p.refunded_at,
    CASE WHEN p.refunded_at IS NOT NULL THEN 'refund' END
FROM (
    VALUES
        (
            '018f10d0-0006-7000-8000-000000000001'::uuid,
            'PrchMMBRAAA1',
            'PrchEPSDAAA1',
            '2026-03-01T12:00:00Z'::timestamptz,
            'stripe',
            'cs_purchases_e2e_1',
            'pi_purchases_e2e_1',
            NULL,
            NULL,
            NULL::integer,
            NULL::timestamptz
        ),
        (
            '018f10d0-0006-7000-8000-000000000002'::uuid,
            'PrchMMBRAAA2',
            'PrchEPSDAAA2',
            '2026-02-15T12:00:00Z'::timestamptz,
            NULL,
            NULL,
            NULL,
            'google_play',
            'GPA.purchases-e2e-2',
            NULL::integer,
            NULL::timestamptz
        ),
        (
            '018f10d0-0006-7000-8000-000000000003'::uuid,
            'PrchMMBRAAA2',
            'PrchEPSDAAA1',
            '2026-01-20T12:00:00Z'::timestamptz,
            'stripe',
            'cs_purchases_e2e_3',
            'pi_purchases_e2e_3',
            NULL,
            NULL,
            500,
            '2026-01-21T00:00:00Z'::timestamptz
        )
) AS p(
    id,
    reader_public_id,
    episode_public_id,
    purchased_at,
    provider,
    provider_checkout_id,
    provider_payment_id,
    store,
    store_transaction_id,
    refunded_amount,
    refunded_at
)
JOIN users u ON u.public_id = p.reader_public_id
JOIN episodes e ON e.public_id = p.episode_public_id;
