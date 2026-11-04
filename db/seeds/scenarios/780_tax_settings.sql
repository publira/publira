-- Scenario: a tenant whose prices came to include tax in the middle of a month
-- of sales, to set its invoice details and close that month
--
-- `admin.tax-settings.spec.ts` saves the tenant's withholding rate and
-- invoice details on Settings, reads the tax of each purchase, the month's on
-- Revenue, and closes January 2026 into a statement that states tax and
-- withholding. The settings and a close are tenant-wide, and a close is never
-- reopened, so no tenant another suite reads can absorb them.
--
-- Applying it is also how the suite starts over. A closed statement refuses
-- every change but the one a deleted tenant makes to it, so the tenant is
-- deleted and written again rather than its statements.
-- public_id values are hard-coded in e2e/src/scenarios/tax-settings.ts.
--   tenant  TaxsTNNTAAA1 (tax.localhost / admin.tax.localhost)
--   admin   TaxsADMNAAA1 (tax-admin@example.com)
--   editor  TaxsEDTRAAA1 (tax-editor@example.com)
--   series  TaxsSERSAAA1, episode TaxsEPSDAAA1 (1,100 yen)
--   author  TaxsAUTHAAA1 (Artist, 50%)

-- Sales and the catalog restrict the deletes that would reach them from the
-- tenant, so they go first, in the order deleteTenantsByPublicIds uses.
DELETE FROM purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'TaxsTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'TaxsTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'TaxsTNNTAAA1');

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'TaxsTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'TaxsTNNTAAA1';

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
    '018f1760-0001-7000-8000-000000000001'::uuid,
    'TaxsTNNTAAA1',
    'tax.localhost:' || :'tenant_port',
    'admin.tax.localhost:' || :'tenant_port',
    'Tax Tenant',
    'active',
    'en',
    ARRAY['en']
);

\set seed_tenant TaxsTNNTAAA1
\ir ../creator_roles.sql

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
    seed.id,
    t.id,
    seed.public_id,
    seed.email,
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    seed.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f1760-0002-7000-8000-000000000001'::uuid,
            'TaxsADMNAAA1',
            'tax-admin@example.com',
            'Tax E2E Admin'
        ),
        (
            '018f1760-0002-7000-8000-000000000002'::uuid,
            'TaxsEDTRAAA1',
            'tax-editor@example.com',
            'Tax E2E Editor'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'TaxsTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT seed.id, u.id, seed.role, u.tenant_id
FROM (
    VALUES
        (
            '018f1760-0003-7000-8000-000000000001'::uuid,
            'TaxsADMNAAA1',
            'tenant_admin'
        ),
        (
            '018f1760-0003-7000-8000-000000000002'::uuid,
            'TaxsEDTRAAA1',
            'tenant_editor'
        )
) AS seed (id, public_id, role)
JOIN users u ON u.public_id = seed.public_id;

INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f1760-0004-7000-8000-000000000001'::uuid,
    t.id,
    'TaxsLABLAAA1',
    'Tax Label 01'
FROM tenants t
WHERE t.public_id = 'TaxsTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    '018f1760-0005-7000-8000-000000000001'::uuid,
    t.id,
    'TaxsAUTHAAA1',
    'Tax Artist',
    ''
FROM tenants t
WHERE t.public_id = 'TaxsTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    '018f1760-0006-7000-8000-000000000001'::uuid,
    t.id,
    '018f1760-0004-7000-8000-000000000001'::uuid,
    'TaxsSERSAAA1',
    true,
    '2025-12-01T00:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'TaxsTNNTAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f1760-0009-7000-8000-000000000001'::uuid,
    s.id,
    s.tenant_id,
    'en',
    'Tax Series 001',
    ''
FROM series s
WHERE s.public_id = 'TaxsSERSAAA1';

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    '018f1760-0007-7000-8000-000000000001'::uuid,
    s.id,
    'TaxsEPSDAAA1',
    1,
    s.tenant_id
FROM series s
WHERE s.public_id = 'TaxsSERSAAA1';

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    '018f1760-000a-7000-8000-000000000001'::uuid,
    e.id,
    e.tenant_id,
    'en',
    'Tax Episode 001-01'
FROM episodes e
WHERE e.public_id = 'TaxsEPSDAAA1';

INSERT INTO episode_listings (
    episode_id,
    price,
    reading_period_hours,
    status,
    scheduled_at,
    published_at,
    tenant_id
)
SELECT
    e.id,
    1100,
    72,
    'published',
    NULL::timestamptz,
    '2025-12-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
WHERE e.public_id = 'TaxsEPSDAAA1';

INSERT INTO episode_creators (
    tenant_id,
    episode_id,
    creator_id,
    role_id,
    display_order,
    source,
    share_bps
)
SELECT
    e.tenant_id,
    e.id,
    c.id,
    r.id,
    1,
    'episode',
    5000
FROM episodes e
JOIN creators c ON c.public_id = 'TaxsAUTHAAA1'
JOIN creator_roles r ON r.tenant_id = e.tenant_id AND r.name = 'Artist'
WHERE e.public_id = 'TaxsEPSDAAA1';

-- The tenant's prices came to include 10% on 16 January 2026. The rate is
-- written before the sales, since a purchase records the rate in effect when
-- it was made as it is inserted.
INSERT INTO tenant_tax_rates (tenant_id, applies_from, rate_bps)
SELECT t.id, '2026-01-16T00:00:00Z'::timestamptz, 1000
FROM tenants t
WHERE t.public_id = 'TaxsTNNTAAA1';

-- January 2026 in the tenant's zone (UTC): two sales of the 1,100-yen episode
-- on the 10th, made without a rate, and two on the 20th, each recording the
-- 100 yen of tax its price includes. The buyer is left unset the way a deleted
-- reader leaves it; a statement never names one.
INSERT INTO purchases (id, user_id, episode_id, price_at_purchase, currency, purchased_at, tenant_id)
SELECT
    ('018f1760-0008-7000-8000-' || lpad(n::text, 12, '0'))::uuid,
    NULL,
    e.id,
    1100,
    'JPY',
    CASE
        WHEN n <= 2 THEN '2026-01-10T12:00:00Z'::timestamptz
        ELSE '2026-01-20T12:00:00Z'::timestamptz
    END + n * INTERVAL '1 hour',
    e.tenant_id
FROM episodes e
CROSS JOIN generate_series(1, 4) AS n
WHERE e.public_id = 'TaxsEPSDAAA1';
