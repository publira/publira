-- Scenario: an episode sold both as a rental and as a permanent copy
--
-- `storefront.episode-rentals.spec.ts` takes the tenant's payments through
-- Stripe from the console, which is what lets the gate sell at all, then
-- reads the gate's two sales as a reader who holds neither, and opens the
-- episode and the library as a reader who holds the rental. The payment
-- settings decide whether the storefront sells the episode, so no tenant
-- another suite reads can absorb them.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes its payment settings with it, and the rental
-- starts again with 47 hours left. Sales, the views the holder's reading
-- recorded, and the catalog restrict the deletes that would reach them from
-- the tenant, so they go first.
-- public_id values are hard-coded in e2e/src/scenarios/episode-rentals.ts.
--   tenant   RntlTNNTAAA1 (rentals.localhost / admin.rentals.localhost)
--   admin    RntlADMNAAA1 (rentals-admin@example.com)
--   readers  RntlMMBRAAA1 (Rental Chooser), RntlMMBRAAA2 (Rental Holder)
--   series   RntlSERSAAA1, episode RntlEPSDAAA1 (300 yen, or 100 for 48 hours)

DELETE FROM purchases
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
            '018f1100-0002-7000-8000-000000000001'::uuid,
            'RntlADMNAAA1',
            'rentals-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Rentals E2E Admin'
        ),
        (
            '018f1100-0002-7000-8000-000000000002'::uuid,
            'RntlMMBRAAA1',
            'rental-chooser@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Rental Chooser'
        ),
        (
            '018f1100-0002-7000-8000-000000000003'::uuid,
            'RntlMMBRAAA2',
            'rental-holder@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Rental Holder'
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

INSERT INTO series (id, tenant_id, public_id, is_published, published_at)
SELECT
    '018f1100-0004-7000-8000-000000000001'::uuid,
    t.id,
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
    ''
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE s.public_id = 'RntlSERSAAA1';

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    '018f1100-0006-7000-8000-000000000001'::uuid,
    s.id,
    'RntlEPSDAAA1',
    1,
    s.tenant_id
FROM series s
WHERE s.public_id = 'RntlSERSAAA1';

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    '018f1100-0007-7000-8000-000000000001'::uuid,
    e.id,
    e.tenant_id,
    t.default_locale,
    'Rental Episode 001-01'
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE e.public_id = 'RntlEPSDAAA1';

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

-- Three pages, so the viewer has something to draw for the reader who holds
-- the rental. The objects are uploaded by `e2e/scripts/upload-episode-pages.sh`,
-- which reads these object keys back out of the database, so the two cannot
-- drift apart.
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    ('018f1100-0008-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    e.id,
    page_number
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.public_id = 'RntlEPSDAAA1';

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
    ('018f1100-0009-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    ('018f1100-0008-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    'original',
    's3',
    'tenants/RntlTNNTAAA1/episodes/RntlEPSDAAA1/page-'
        || lpad(page_number::text, 2, '0')
        || '-original.jpg',
    'image/jpeg',
    120000,
    -- db/seeds/objects/episode-page/page-NN.jpg
    1050,
    1500
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.public_id = 'RntlEPSDAAA1';

-- The holder rented the episode through Stripe an hour ago, so the rental has
-- 47 of its 48 hours left. The chooser holds nothing.
INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    kind,
    price_at_purchase,
    currency,
    purchased_at,
    expires_at,
    provider,
    provider_checkout_id,
    provider_payment_id
)
SELECT
    '018f1100-000a-7000-8000-000000000001'::uuid,
    u.tenant_id,
    u.id,
    e.id,
    'rental',
    100,
    'JPY',
    NOW() - INTERVAL '1 hour',
    NOW() + INTERVAL '47 hours',
    'stripe',
    'cs_rentals_e2e_1',
    'pi_rentals_e2e_1'
FROM users u
JOIN episodes e ON e.public_id = 'RntlEPSDAAA1'
WHERE u.public_id = 'RntlMMBRAAA2';
