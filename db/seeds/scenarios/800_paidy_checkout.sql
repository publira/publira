-- Scenario: a tenant that sells an episode through Paidy
--
-- `storefront.paidy-checkout.spec.ts` takes the tenant's payments through the
-- E2E stack's Paidy stand-in from the console, which is what lets the site
-- sell at all, then has one reader authorize the payment in the fake of Paidy
-- Checkout on the storefront's payment page and read the episode, and another
-- close it and find nothing bought. The payment settings decide whether the
-- storefront sells anything, so no tenant another suite reads can absorb them.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes its payment settings and every sale with it, so
-- the readers hold nothing again. Sales, the views the readers' reading
-- recorded, and the catalog restrict the deletes that would reach them from
-- the tenant, so they go first.
-- public_id values are hard-coded in e2e/src/scenarios/paidy-checkout.ts.
--   tenant   PidyTNNTAAA1 (paidy.localhost / admin.paidy.localhost)
--   admin    PidyADMNAAA1 (paidy-admin@example.com)
--   readers  PidyMMBRAAA1 (Paidy Payer), PidyMMBRAAA2 (Paidy Leaver)
--   series   PidySERSAAA1, episode PidyEPSDAAA1 (500 yen, three pages)

DELETE FROM purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PidyTNNTAAA1');

DELETE FROM content_events
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PidyTNNTAAA1');

DELETE FROM episode_image_variants
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PidyTNNTAAA1');

DELETE FROM episode_images
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PidyTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PidyTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PidyTNNTAAA1');

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PidyTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'PidyTNNTAAA1';

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
    '018f1200-0001-7000-8000-000000000001'::uuid,
    'PidyTNNTAAA1',
    'paidy.localhost:' || :'tenant_port',
    'admin.paidy.localhost:' || :'tenant_port',
    'Paidy Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant PidyTNNTAAA1
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
            '018f1200-0002-7000-8000-000000000001'::uuid,
            'PidyADMNAAA1',
            'paidy-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Paidy E2E Admin'
        ),
        (
            '018f1200-0002-7000-8000-000000000002'::uuid,
            'PidyMMBRAAA1',
            'paidy-payer@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Paidy Payer'
        ),
        (
            '018f1200-0002-7000-8000-000000000003'::uuid,
            'PidyMMBRAAA2',
            'paidy-leaver@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Paidy Leaver'
        )
) AS u(id, public_id, email, password_hash, name)
WHERE t.public_id = 'PidyTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1200-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'PidyADMNAAA1';

INSERT INTO series (id, tenant_id, public_id, is_published, published_at)
SELECT
    '018f1200-0004-7000-8000-000000000001'::uuid,
    t.id,
    'PidySERSAAA1',
    true,
    '2026-01-01T00:00:00Z'::timestamptz
FROM tenants t
WHERE t.public_id = 'PidyTNNTAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    '018f1200-0007-7000-8000-000000000001'::uuid,
    s.id,
    s.tenant_id,
    t.default_locale,
    'Paidy Series 001',
    ''
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE s.public_id = 'PidySERSAAA1';

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    '018f1200-0005-7000-8000-000000000001'::uuid,
    s.id,
    'PidyEPSDAAA1',
    1,
    s.tenant_id
FROM series s
WHERE s.public_id = 'PidySERSAAA1';

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    '018f1200-0008-7000-8000-000000000001'::uuid,
    e.id,
    e.tenant_id,
    t.default_locale,
    'Paidy Episode 001-01'
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE e.public_id = 'PidyEPSDAAA1';

INSERT INTO episode_listings (episode_id, price, status, published_at, tenant_id)
SELECT
    e.id,
    500,
    'published',
    '2026-01-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
WHERE e.public_id = 'PidyEPSDAAA1';

-- Three pages, so the viewer has something to draw for a reader the checkout
-- opened the episode to. The objects are uploaded by
-- `e2e/scripts/upload-episode-pages.sh`, which reads these object keys back
-- out of the database, so the two cannot drift apart.
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    ('018f1200-0009-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    e.id,
    page_number
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.public_id = 'PidyEPSDAAA1';

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
    ('018f1200-000a-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    ('018f1200-0009-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    'original',
    's3',
    'tenants/PidyTNNTAAA1/episodes/PidyEPSDAAA1/page-'
        || lpad(page_number::text, 2, '0')
        || '-original.jpg',
    'image/jpeg',
    120000,
    -- db/seeds/objects/episode-page/page-NN.jpg
    1050,
    1500
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.public_id = 'PidyEPSDAAA1';
