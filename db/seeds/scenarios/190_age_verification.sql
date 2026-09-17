-- Scenario: a tenant that makes readers prove an age for its `r18` work
--
-- `host.age-verification.spec.ts` asserts that an `r18` body stays closed to a
-- reader the rule stops. `tenant_config.age_verification` is one setting for a
-- whole tenant, so a suite that turns it on cannot share a tenant with the ones
-- reading the dev seed's rated series: `host.age-rating.spec.ts` confirms the
-- browser interstitial there and then opens the body behind it, which is
-- exactly what this rule takes away.
--
-- Three members, because the gate has three answers and the reader's own row is
-- what picks one: an adult opens the body, a minor is told their age, and a
-- reader with no date on file is sent to the settings screen to give one. A
-- fourth, born as the minor is, is the reader whose date the console suite
-- corrects, so no other suite's reader changes under it.
-- Password hashes match the dev seed (`memberpass`).
--
-- Birth dates are intervals from `NOW()` rather than literals: a date written
-- once would drift into a different age as the years pass, and the age is the
-- whole point of the rows. Applying this file is also how the suite resets
-- itself — it signs the third member up for a date, and a birth date is written
-- once, so the `NULL` below is what lets a re-run start from no date at all.
--
-- public_id values are hard-coded in e2e/src/scenarios/age-verification.ts.
--   tenant   AverTNNTAAA1 (age.localhost / admin.age.localhost)
--   label    AverLABLAAA1
--   creator  AverAUTHAAA1
--   series   AverSERSAAA1 (rated r18)
--   episode  AverEPSDAAA1 (free, published)
--   members  AverMMBRAAA1 (adult) / AverMMBRAAA2 (minor) / AverMMBRAAA3 (no date)
--            AverMMBRAAA4 (minor until the console corrects the date)
--   admin    AverADMNAAA1 (age-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f0fa0-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
SELECT
    ts.id,
    'AverTNNTAAA1',
    'age.localhost',
    'admin.age.localhost',
    'Age Verification Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

-- `r18`: an `r18` series demands a proven 18, and an `r15` one is left to the
-- browser's own confirmation. The suite reads the first half of that.
INSERT INTO tenant_config (tenant_id, age_verification)
SELECT t.id, 'r18'
FROM tenants t
WHERE t.domain = 'age.localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET age_verification = EXCLUDED.age_verification,
    updated_at = NOW();

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'age.localhost'
),
label_seed AS (
    SELECT '018f0fa1-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    ls.id AS label_id,
    ts.id AS tenant_id,
    'AverLABLAAA1',
    'Age Verification Label 01'
FROM label_seed ls
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'age.localhost'
),
creator_seed AS (
    SELECT '018f0fa2-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    cs.id AS creator_id,
    ts.id AS tenant_id,
    'AverAUTHAAA1',
    'Age Verification Author 001',
    'Profile text for Age Verification Author 001'
FROM creator_seed cs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    profile_text = EXCLUDED.profile_text;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'age.localhost'
)
INSERT INTO series (id, tenant_id, label_id, public_id, title, is_published, published_at)
SELECT
    '018f0fa3-0001-7000-8000-000000000001'::uuid,
    ts.id AS tenant_id,
    l.id AS label_id,
    'AverSERSAAA1',
    'Age Verification Series 001',
    true,
    NOW() - INTERVAL '1 day'
FROM tenant_scope ts
JOIN labels l ON l.id = '018f0fa1-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    title = EXCLUDED.title,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

INSERT INTO series_listings (series_id, synopsis, reading_period_hours, age_rating, tenant_id)
SELECT
    s.id AS series_id,
    'Age verification series synopsis for Age Verification Series 001',
    72,
    'r18',
    s.tenant_id
FROM series s
WHERE s.id = '018f0fa3-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id) DO UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours,
    age_rating = EXCLUDED.age_rating,
    tenant_id = EXCLUDED.tenant_id;

\set seed_tenant AverTNNTAAA1
\ir ../creator_roles.sql

INSERT INTO series_creators (series_id, creator_id, role_id, display_order, tenant_id)
SELECT
    s.id AS series_id,
    c.id AS creator_id,
    cr.id,
    1,
    s.tenant_id
FROM series s
JOIN creators c ON c.id = '018f0fa2-0001-7000-8000-000000000001'::uuid
JOIN creator_roles cr ON cr.tenant_id = s.tenant_id AND cr.name = 'Original Author'
WHERE s.id = '018f0fa3-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id, creator_id, role_id) DO UPDATE
SET display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    '018f0fa4-0001-7000-8000-000000000001'::uuid,
    s.id AS series_id,
    'AverEPSDAAA1',
    'Age Verification Episode 001-01',
    1,
    s.tenant_id
FROM series s
WHERE s.id = '018f0fa3-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

-- Free, so the age rule is the only thing that can close the body: a paid
-- episode nobody bought would be withheld for a reason this suite is not about.
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
    e.id AS episode_id,
    0,
    72,
    'published',
    NULL::timestamptz,
    NOW() - INTERVAL '12 hours',
    e.tenant_id
FROM episodes e
WHERE e.id = '018f0fa4-0001-7000-8000-000000000001'::uuid
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;

-- Two pages, which is what makes "the body opened" something the suite can see.
-- The objects themselves are uploaded by `e2e/scripts/upload-episode-pages.sh`,
-- which reads these object keys back out of the database, so the two cannot
-- drift apart.
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    ('018f0fa5-0001-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    e.id,
    page_number
FROM episodes e
CROSS JOIN generate_series(1, 2) AS page_number
WHERE e.id = '018f0fa4-0001-7000-8000-000000000001'::uuid
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
    ('018f0fa6-0001-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    e.tenant_id,
    ('018f0fa5-0001-7000-8000-' || lpad(page_number::text, 12, '0'))::uuid,
    'original',
    's3',
    'tenants/AverTNNTAAA1/episodes/AverEPSDAAA1/page-'
        || lpad(page_number::text, 2, '0')
        || '-original.jpg',
    'image/jpeg',
    -- Reported to the reader as the page's byte size. What the browser
    -- downloads is image-server's rendition rather than this JPEG, so the
    -- fixture's own size only has to be in the right range.
    120000,
    -- db/seeds/objects/episode-page/page-NN.jpg
    1050,
    1500
FROM episodes e
CROSS JOIN generate_series(1, 2) AS page_number
WHERE e.id = '018f0fa4-0001-7000-8000-000000000001'::uuid
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

WITH member_seed (id, public_id, email, name, birth_date) AS (
    VALUES
        (
            '018f0fa7-0001-7000-8000-000000000001'::uuid,
            'AverMMBRAAA1',
            'age-adult@example.com',
            'Age E2E Adult',
            (NOW() - INTERVAL '30 years')::date
        ),
        (
            '018f0fa7-0002-7000-8000-000000000002'::uuid,
            'AverMMBRAAA2',
            'age-minor@example.com',
            'Age E2E Minor',
            (NOW() - INTERVAL '16 years')::date
        ),
        (
            '018f0fa7-0003-7000-8000-000000000003'::uuid,
            'AverMMBRAAA3',
            'age-undeclared@example.com',
            'Age E2E Undeclared',
            NULL::date
        ),
        (
            '018f0fa7-0004-7000-8000-000000000004'::uuid,
            'AverMMBRAAA4',
            'age-corrected@example.com',
            'Age E2E Corrected',
            (NOW() - INTERVAL '16 years')::date
        )
)
INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    email_verified_at,
    birth_date
)
SELECT
    ms.id,
    t.id,
    ms.public_id,
    ms.email,
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    ms.name,
    'active',
    NOW(),
    ms.birth_date
FROM member_seed ms
JOIN tenants t ON t.domain = 'age.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at,
    birth_date = EXCLUDED.birth_date;

-- The tenant admin the console step signs in as. The rule is one setting for
-- the whole tenant, so the console that changes it has to be this tenant's own;
-- the dev seed admin administers a tenant whose rated series another suite
-- opens by confirming. Password hash matches the dev seed (`adminpass`).
WITH admin_user_seed AS (
    SELECT '018f0fa8-0001-7000-8000-000000000001'::uuid AS id
)
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
    aus.id,
    t.id,
    'AverADMNAAA1',
    'age-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Age E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.domain = 'age.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0fa9-0001-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'AverADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;
