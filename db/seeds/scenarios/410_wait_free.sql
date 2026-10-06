-- Scenario: a series that offers wait-for-free
--
-- `host.wait-free.spec.ts` reads the rule off the series page, spends a ticket
-- from the episode gate, and then meets the countdown and the excluded latest
-- episode. The rule is a series setting, but the suite runs on a tenant of its
-- own all the same: the series would otherwise sit in the dev seed's catalogue
-- the screenshot and catalogue suites read, and the ticket the member spends is
-- state no other suite should find half-way through.
--
-- Three priced episodes, the rule keeping a ticket off the latest one, and one
-- member who holds no purchase or ticket. Password hash matches the dev seed
-- (`memberpass`). Applying this file is also how the suite resets itself: the
-- member's ticket state and the access tickets it opened are deleted below, so
-- a re-run starts with a ticket ready.
--
-- public_id values are hard-coded in e2e/src/scenarios/wait-free.ts.
--   tenant   WtfrTNNTAAA1 (waitfree.localhost / admin.waitfree.localhost)
--   label    WtfrLABLAAA1
--   creator  WtfrAUTHAAA1
--   series   WtfrSERSAAA1
--   episodes WtfrEPSDAAA1 / WtfrEPSDAAA2 / WtfrEPSDAAA3 (the latest, excluded)
--   member   WtfrMMBRAAA1

WITH tenant_seed AS (
    SELECT '018f1080-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
SELECT
    ts.id,
    'WtfrTNNTAAA1',
    'waitfree.localhost:' || :'tenant_port',
    'admin.waitfree.localhost:' || :'tenant_port',
    'Wait Free Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'WtfrTNNTAAA1'
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f1081-0001-7000-8000-000000000001'::uuid,
    ts.id,
    'WtfrLABLAAA1',
    'Wait Free Label 01'
FROM tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'WtfrTNNTAAA1'
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    '018f1082-0001-7000-8000-000000000001'::uuid,
    ts.id,
    'WtfrAUTHAAA1',
    'Wait Free Author 001',
    'Profile text for Wait Free Author 001'
FROM tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    profile_text = EXCLUDED.profile_text;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'WtfrTNNTAAA1'
)
INSERT INTO series (id, tenant_id, label_id, public_id, title, is_published, published_at)
SELECT
    '018f1083-0001-7000-8000-000000000001'::uuid,
    ts.id,
    '018f1081-0001-7000-8000-000000000001'::uuid,
    'WtfrSERSAAA1',
    'Wait Free Series 001',
    true,
    NOW() - INTERVAL '3 days'
FROM tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    title = EXCLUDED.title,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

INSERT INTO series_listings (series_id, synopsis, reading_period_hours, tenant_id)
SELECT
    s.id,
    'Synopsis for Wait Free Series 001',
    72,
    s.tenant_id
FROM series s
WHERE s.id = '018f1083-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id) DO UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours,
    tenant_id = EXCLUDED.tenant_id;

-- A ticket is ready 23 hours after it is used and opens an episode for 72,
-- and the latest episode is kept off it.
INSERT INTO series_wait_free_settings (
    tenant_id,
    series_id,
    enabled,
    recharge_hours,
    access_hours,
    excluded_latest_count
)
SELECT
    s.tenant_id,
    s.id,
    true,
    23,
    72,
    1
FROM series s
WHERE s.id = '018f1083-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id) DO UPDATE
SET enabled = EXCLUDED.enabled,
    recharge_hours = EXCLUDED.recharge_hours,
    access_hours = EXCLUDED.access_hours,
    excluded_latest_count = EXCLUDED.excluded_latest_count;

\set seed_tenant WtfrTNNTAAA1
\ir ../creator_roles.sql

INSERT INTO series_creators (series_id, creator_id, role_id, display_order, tenant_id)
SELECT
    s.id,
    c.id,
    cr.id,
    1,
    s.tenant_id
FROM series s
JOIN creators c ON c.id = '018f1082-0001-7000-8000-000000000001'::uuid
JOIN creator_roles cr ON cr.tenant_id = s.tenant_id AND cr.name = 'Original Author'
WHERE s.id = '018f1083-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id, creator_id, role_id) DO UPDATE
SET display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

WITH episode_seed (id, public_id, title, order_index) AS (
    VALUES
        ('018f1084-0001-7000-8000-000000000001'::uuid, 'WtfrEPSDAAA1', 'Wait Free Episode 001-01', 1),
        ('018f1084-0002-7000-8000-000000000002'::uuid, 'WtfrEPSDAAA2', 'Wait Free Episode 001-02', 2),
        ('018f1084-0003-7000-8000-000000000003'::uuid, 'WtfrEPSDAAA3', 'Wait Free Episode 001-03', 3)
)
INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    es.id,
    s.id,
    es.public_id,
    es.title,
    es.order_index,
    s.tenant_id
FROM episode_seed es
JOIN series s ON s.id = '018f1083-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

-- Priced, so the gate closes over every one of them, and published a day
-- apart in reading order, so the third is the latest.
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
    300,
    72,
    'published',
    NULL::timestamptz,
    NOW() - (4 - e.order_index) * INTERVAL '1 day',
    e.tenant_id
FROM episodes e
WHERE e.series_id = '018f1083-0001-7000-8000-000000000001'::uuid
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;

-- Three pages on the first episode, the one the suite opens with a ticket, so
-- the viewer has something to draw once the gate lifts. The objects are
-- uploaded by `e2e/scripts/upload-episode-pages.sh`, which reads these object
-- keys back out of the database, so the two cannot drift apart.
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    ('018f1086-0001-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    e.id,
    page_number
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.id = '018f1084-0001-7000-8000-000000000001'::uuid
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    episode_id = EXCLUDED.episode_id,
    display_order = EXCLUDED.display_order;

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
    ('018f1087-0001-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    ('018f1086-0001-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    'original',
    's3',
    'tenants/WtfrTNNTAAA1/episodes/WtfrEPSDAAA1/page-'
        || lpad(page_number::text, 2, '0')
        || '-original.jpg',
    'image/jpeg',
    120000,
    -- db/seeds/objects/episode-page/page-NN.jpg
    1050,
    1500
FROM episodes e
CROSS JOIN generate_series(1, 3) AS page_number
WHERE e.id = '018f1084-0001-7000-8000-000000000001'::uuid
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    episode_image_id = EXCLUDED.episode_image_id,
    label = EXCLUDED.label,
    storage_provider = EXCLUDED.storage_provider,
    object_key = EXCLUDED.object_key,
    content_type = EXCLUDED.content_type,
    file_size_bytes = EXCLUDED.file_size_bytes,
    width = EXCLUDED.width,
    height = EXCLUDED.height;

\ir ../episode_creators.sql

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
    '018f1085-0001-7000-8000-000000000001'::uuid,
    t.id,
    'WtfrMMBRAAA1',
    'wait-free-member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Wait Free Member',
    'active',
    NOW()
FROM tenants t
WHERE t.public_id = 'WtfrTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

-- A ticket ready again, and no episode open: a previous run spent the ticket
-- and opened the first episode with it.
DELETE FROM wait_free_ticket_states
WHERE user_id = '018f1085-0001-7000-8000-000000000001'::uuid;

DELETE FROM access_tickets
WHERE user_id = '018f1085-0001-7000-8000-000000000001'::uuid;
