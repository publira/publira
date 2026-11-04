-- Scenario: a tenant whose promotion codes the console issues and lists
--
-- `admin.promotion-codes.spec.ts` creates, pauses, resumes, and deletes a code
-- at `/promotion-codes`, reads the redemption of the code seeded here, and
-- follows it to the purchase it discounted; the documentation photographs the
-- same screens. Every code changes what the tenant's app has to sell and
-- whether the storefront offers a code at all, so no tenant another suite
-- reads can absorb them.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, with every code the suite created. Sales, codes, and the
-- catalog restrict the deletes that would reach them from the tenant, so they
-- go first.
-- public_id values are hard-coded in e2e/src/scenarios/promotion-codes.ts.
--   tenant   PrmoTNNTAAA1 (promo.localhost / admin.promo.localhost)
--   admin    PrmoADMNAAA1 (promo-admin@example.com)
--   editor   PrmoEDTRAAA1 (promo-editor@example.com)
--   reader   PrmoMMBRAAA1 (Promo Buyer)
--   series   PrmoSERSAAA1, episodes PrmoEPSDAAA1 and PrmoEPSDAAA2 (500 yen)
--   codes    WELCOME10 (10% off the whole catalog, redeemed once), SPRING100
--            (100 yen off the series, from 2026 to 2036)

DELETE FROM promotion_code_redemptions
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrmoTNNTAAA1');

DELETE FROM purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrmoTNNTAAA1');

DELETE FROM promotion_codes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrmoTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrmoTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrmoTNNTAAA1');

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PrmoTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'PrmoTNNTAAA1';

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
    '018f1770-0001-7000-8000-000000000001'::uuid,
    'PrmoTNNTAAA1',
    'promo.localhost:' || :'tenant_port',
    'admin.promo.localhost:' || :'tenant_port',
    'Promotion Codes Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant PrmoTNNTAAA1
\ir ../creator_roles.sql

-- The admin, the editor, and the reader. The password hash is the same as
-- `adminpass` for the staff and `memberpass` for the reader.
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
            '018f1770-0002-7000-8000-000000000001'::uuid,
            'PrmoADMNAAA1',
            'promo-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Promotion Codes E2E Admin'
        ),
        (
            '018f1770-0002-7000-8000-000000000002'::uuid,
            'PrmoEDTRAAA1',
            'promo-editor@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Promotion Codes E2E Editor'
        ),
        (
            '018f1770-0002-7000-8000-000000000003'::uuid,
            'PrmoMMBRAAA1',
            'promo-buyer@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Promo Buyer'
        )
) AS u(id, public_id, email, password_hash, name)
WHERE t.public_id = 'PrmoTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    r.id,
    u.id,
    r.role,
    u.tenant_id
FROM (
    VALUES
        ('018f1770-0003-7000-8000-000000000001'::uuid, 'PrmoADMNAAA1', 'tenant_admin'),
        ('018f1770-0003-7000-8000-000000000002'::uuid, 'PrmoEDTRAAA1', 'tenant_editor')
) AS r(id, user_public_id, role)
JOIN users u ON u.public_id = r.user_public_id;

INSERT INTO series (id, tenant_id, public_id, is_published, published_at)
SELECT
    '018f1770-0004-7000-8000-000000000001'::uuid,
    t.id,
    'PrmoSERSAAA1',
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'PrmoTNNTAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f1770-0007-7000-8000-000000000001'::uuid,
    s.id,
    s.tenant_id,
    t.default_locale,
    'Promotion Series 001',
    ''
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE s.public_id = 'PrmoSERSAAA1';

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
        ('018f1770-0005-7000-8000-000000000001'::uuid, 'PrmoEPSDAAA1', 1),
        ('018f1770-0005-7000-8000-000000000002'::uuid, 'PrmoEPSDAAA2', 2)
) AS e(id, public_id, order_index)
WHERE s.public_id = 'PrmoSERSAAA1';

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    tr.id,
    e.id,
    e.tenant_id,
    t.default_locale,
    tr.title
FROM (
    VALUES
        ('018f1770-0008-7000-8000-000000000001'::uuid, 'PrmoEPSDAAA1', 'Promotion Episode 001-01'),
        ('018f1770-0008-7000-8000-000000000002'::uuid, 'PrmoEPSDAAA2', 'Promotion Episode 001-02')
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
WHERE e.public_id IN ('PrmoEPSDAAA1', 'PrmoEPSDAAA2');

-- Two codes on fixed dates, so the screens that list them do not move with
-- today's: WELCOME10, 10% off the whole catalog with no window and a limit of
-- one per reader, and SPRING100, 100 yen off the series until 2036 and at most
-- 500 purchases in all.
INSERT INTO promotion_codes (
    id,
    tenant_id,
    code,
    discount_kind,
    discount_value,
    target_kind,
    target_id,
    starts_at,
    ends_at,
    max_redemptions,
    max_redemptions_per_reader,
    created_by_user_id,
    created_at,
    updated_at
)
SELECT
    c.id,
    t.id,
    c.code,
    c.discount_kind,
    c.discount_value,
    c.target_kind,
    c.target_id,
    c.starts_at,
    c.ends_at,
    c.max_redemptions,
    c.max_redemptions_per_reader,
    '018f1770-0002-7000-8000-000000000001'::uuid,
    c.created_at,
    c.created_at
FROM tenants t
CROSS JOIN (
    VALUES
        (
            '018f1770-0009-7000-8000-000000000001'::uuid,
            'WELCOME10',
            'percent',
            10,
            'catalog',
            NULL::uuid,
            NULL::timestamptz,
            NULL::timestamptz,
            NULL::integer,
            1,
            '2026-02-01T00:00:00Z'::timestamptz
        ),
        (
            '018f1770-0009-7000-8000-000000000002'::uuid,
            'SPRING100',
            'amount',
            100,
            'series',
            '018f1770-0004-7000-8000-000000000001'::uuid,
            '2026-03-01T00:00:00Z'::timestamptz,
            '2036-04-01T00:00:00Z'::timestamptz,
            500,
            NULL::integer,
            '2026-02-15T00:00:00Z'::timestamptz
        )
) AS c(
    id,
    code,
    discount_kind,
    discount_value,
    target_kind,
    target_id,
    starts_at,
    ends_at,
    max_redemptions,
    max_redemptions_per_reader,
    created_at
)
WHERE t.public_id = 'PrmoTNNTAAA1';

-- The reader bought episode 01 through Stripe with WELCOME10: 500 yen less
-- 10%, so they paid 450 and the episode's Authors are paid on 500.
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    price_at_purchase,
    list_price,
    promotion_code_id,
    currency,
    purchased_at,
    provider,
    provider_checkout_id,
    provider_payment_id
)
SELECT
    '018f1770-0006-7000-8000-000000000001'::uuid,
    u.tenant_id,
    u.id,
    e.id,
    450,
    500,
    '018f1770-0009-7000-8000-000000000001'::uuid,
    'JPY',
    '2026-03-02T12:00:00Z'::timestamptz,
    'stripe',
    'cs_promotion_codes_e2e_1',
    'pi_promotion_codes_e2e_1'
FROM users u
JOIN episodes e ON e.public_id = 'PrmoEPSDAAA1'
WHERE u.public_id = 'PrmoMMBRAAA1';

INSERT INTO promotion_code_redemptions (
    id,
    tenant_id,
    promotion_code_id,
    user_id,
    purchase_id,
    redeemed_at
)
SELECT
    '018f1770-000a-7000-8000-000000000001'::uuid,
    p.tenant_id,
    p.promotion_code_id,
    p.user_id,
    p.id,
    p.purchased_at
FROM purchases p
WHERE p.id = '018f1770-0006-7000-8000-000000000001'::uuid;
