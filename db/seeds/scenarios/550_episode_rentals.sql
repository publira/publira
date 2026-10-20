-- Scenario: a series sold by the episode, by the volume, and as a whole
--
-- `storefront.checkout.spec.ts` takes the tenant's payments through the E2E
-- stack's Stripe stand-in from the console, which is what lets the site sell
-- at all, then has its readers buy through Checkout: one rents the first
-- episode and another buys it at the gate, a third buys the volume holding
-- episodes 2 and 3 from the series page, a fourth buys every episode at the
-- series' bundle discount, after the admin changes that discount on the
-- series form, and a fifth buys episode 4 at the campaign price open on it.
-- The payment settings decide whether the storefront sells anything, so no
-- tenant another suite reads can absorb them.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes its payment settings and every sale with it, so
-- the readers hold nothing again. Sales, the bundles they paid for, the views
-- the readers' reading recorded, the volumes, and the catalog restrict the
-- deletes that would reach them from the tenant, so they go first.
-- public_id values are hard-coded in e2e/src/scenarios/episode-rentals.ts.
--   tenant   RntlTNNTAAA1 (rentals.localhost / admin.rentals.localhost)
--   admin    RntlADMNAAA1 (rentals-admin@example.com)
--   readers  RntlMMBRAAA1 (Rental Renter), RntlMMBRAAA2 (Rental Buyer),
--            RntlMMBRAAA3 (Volume Buyer), RntlMMBRAAA4 (Remainder Buyer),
--            RntlMMBRAAA5 (Campaign Buyer)
--   label    RntlLABLAAA1, which the series form needs to save the series
--   series   RntlSERSAAA1, 10% off the rest of it in one checkout
--   episodes RntlEPSDAAA1 (300 yen, or 100 for 48 hours),
--            RntlEPSDAAA2 to RntlEPSDAAA4 (200 yen each), RntlEPSDAAA4 at
--            150 until 2036-03-30T15:00:00Z (campaign RntlCMPNAAA1)
--   volume   RntlVOLMAAA1, episodes 2 and 3 for 350 yen

DELETE FROM purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RntlTNNTAAA1');

DELETE FROM series_bundles
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RntlTNNTAAA1');

DELETE FROM volumes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RntlTNNTAAA1');

DELETE FROM content_events
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RntlTNNTAAA1');

DELETE FROM episode_image_variants
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RntlTNNTAAA1');

DELETE FROM episode_images
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RntlTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RntlTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'RntlTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'RntlTNNTAAA1';

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
    '018f1100-0001-7000-8000-000000000001'::uuid,
    'RntlTNNTAAA1',
    'rentals.localhost:' || :'tenant_port',
    'admin.rentals.localhost:' || :'tenant_port',
    'Rentals Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant RntlTNNTAAA1
\ir ../creator_roles.sql

-- The admin and the five readers. The password hash is the same as
-- `adminpass` for the admin and `memberpass` for the readers.
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
            '018f1100-0002-7000-8000-000000000001'::uuid,
            'RntlADMNAAA1',
            'rentals-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Rentals E2E Admin'
        ),
        (
            '018f1100-0002-7000-8000-000000000002'::uuid,
            'RntlMMBRAAA1',
            'rental-renter@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Rental Renter'
        ),
        (
            '018f1100-0002-7000-8000-000000000003'::uuid,
            'RntlMMBRAAA2',
            'rental-buyer@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Rental Buyer'
        ),
        (
            '018f1100-0002-7000-8000-000000000004'::uuid,
            'RntlMMBRAAA3',
            'volume-buyer@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Volume Buyer'
        ),
        (
            '018f1100-0002-7000-8000-000000000005'::uuid,
            'RntlMMBRAAA4',
            'remainder-buyer@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Remainder Buyer'
        ),
        (
            '018f1100-0002-7000-8000-000000000006'::uuid,
            'RntlMMBRAAA5',
            'campaign-buyer@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Campaign Buyer'
        )
) AS u(id, public_id, email, password_hash, name)
WHERE t.public_id = 'RntlTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1100-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'RntlADMNAAA1';

INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f1100-000b-7000-8000-000000000001'::uuid,
    t.id,
    'RntlLABLAAA1',
    'Rental Label'
FROM tenants t
WHERE t.public_id = 'RntlTNNTAAA1';

INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    '018f1100-0004-7000-8000-000000000001'::uuid,
    t.id,
    '018f1100-000b-7000-8000-000000000001'::uuid,
    'RntlSERSAAA1',
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'RntlTNNTAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f1100-0005-7000-8000-000000000001'::uuid,
    s.id,
    s.tenant_id,
    t.default_locale,
    'Rental Series 001',
    'A series sold by the episode, by the volume, and as a whole.'
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE s.public_id = 'RntlSERSAAA1';

-- What a checkout of the rest of the series takes off the sum of its
-- episodes' prices.
INSERT INTO series_listings (series_id, bundle_discount_percent, tenant_id)
SELECT s.id, 10, s.tenant_id
FROM series s
WHERE s.public_id = 'RntlSERSAAA1';

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    ('018f1100-0006-7000-8000-' || lpad(episode_number::text, 12, '0'))::uuid,
    s.id,
    'RntlEPSDAAA' || episode_number,
    episode_number,
    s.tenant_id
FROM series s
CROSS JOIN generate_series(1, 4) AS episode_number
WHERE s.public_id = 'RntlSERSAAA1';

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    ('018f1100-0007-7000-8000-' || lpad(e.order_index::text, 12, '0'))::uuid,
    e.id,
    e.tenant_id,
    t.default_locale,
    'Rental Episode 001-' || lpad(e.order_index::text, 2, '0')
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE t.public_id = 'RntlTNNTAAA1';

-- The permanent copy for 300 yen, which opens the episode for good, and the
-- rental for 100, which opens it for 48 hours.
INSERT INTO episode_listings (
    episode_id,
    price,
    rental_price,
    rental_period_hours,
    status,
    published_at,
    tenant_id
)
SELECT
    e.id,
    300,
    100,
    48,
    'published',
    '2026-01-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
WHERE e.public_id = 'RntlEPSDAAA1';

-- The later episodes are sold only to keep, for 200 yen each.
INSERT INTO episode_listings (
    episode_id,
    price,
    status,
    published_at,
    tenant_id
)
SELECT
    e.id,
    200,
    'published',
    '2026-01-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
WHERE e.public_id IN ('RntlEPSDAAA2', 'RntlEPSDAAA3', 'RntlEPSDAAA4');

-- Episode 4 sells for 150 yen instead of its 200 under a campaign that began
-- with the series and ends at a fixed instant, so the end the storefront
-- writes is the same on every run.
INSERT INTO episode_campaign_prices (
    id,
    tenant_id,
    public_id,
    episode_id,
    price,
    starts_at,
    ends_at
)
SELECT
    '018f1100-000b-7000-8000-000000000001'::uuid,
    e.tenant_id,
    'RntlCMPNAAA1',
    e.id,
    150,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2036-03-30T15:00:00Z'::timestamptz
FROM episodes e
WHERE e.public_id = 'RntlEPSDAAA4';

-- Episodes 2 and 3 together for 350 yen, 50 less than buying them one by one.
INSERT INTO volumes (
    id,
    tenant_id,
    public_id,
    series_id,
    title,
    order_index,
    price,
    is_published,
    published_at
)
SELECT
    '018f1100-000a-7000-8000-000000000001'::uuid,
    s.tenant_id,
    'RntlVOLMAAA1',
    s.id,
    'Rental Volume 1',
    1,
    350,
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM series s
WHERE s.public_id = 'RntlSERSAAA1';

INSERT INTO volume_episodes (tenant_id, volume_id, episode_id, "position")
SELECT
    e.tenant_id,
    '018f1100-000a-7000-8000-000000000001'::uuid,
    e.id,
    e.order_index - 2
FROM episodes e
WHERE e.public_id IN ('RntlEPSDAAA2', 'RntlEPSDAAA3');

-- Three pages of each episode, so the viewer has something to draw for a
-- reader the checkout opened it to. The objects are uploaded by
-- `e2e/scripts/upload-episode-pages.sh`, which reads these object keys back
-- out of the database, so the two cannot drift apart.
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    ('018f1100-0008-7000-8000-' || lpad((e.order_index * 100 + page_number)::text, 12, '0'))::uuid,
    e.tenant_id,
    e.id,
    page_number
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
CROSS JOIN generate_series(1, 3) AS page_number
WHERE t.public_id = 'RntlTNNTAAA1';

INSERT INTO episode_image_variants (
    id,
    tenant_id,
    episode_image_id,
    label,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
SELECT
    ('018f1100-0009-7000-8000-' || lpad((e.order_index * 100 + page_number)::text, 12, '0'))::uuid,
    e.tenant_id,
    ('018f1100-0008-7000-8000-' || lpad((e.order_index * 100 + page_number)::text, 12, '0'))::uuid,
    'original',
    's3',
    'tenants/RntlTNNTAAA1/episodes/'
        || e.public_id
        || '/page-'
        || lpad(page_number::text, 2, '0')
        || '-original.jpg',
    'image/jpeg',
    120000,
    -- db/seeds/objects/episode-page/page-NN.jpg
    1050,
    1500
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
CROSS JOIN generate_series(1, 3) AS page_number
WHERE t.public_id = 'RntlTNNTAAA1';
