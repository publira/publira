-- Scenario: a tenant whose comments wait for staff approval
--
-- `admin.comment-moderation.spec.ts` posts a comment as a reader, approves it
-- from the console, and reads it back off the public site. That round trip
-- needs `tenant_config.comment_mode = 'approval_required'`, which is one
-- setting for a whole tenant: the tenant of `140_episode_comments.sql` runs on
-- `immediate` so its own suite can read a comment back without an approval
-- step, so the two cannot share one.
--
-- The tenant therefore owns both sides of the round trip: an administrator to
-- sign into its console as, and a member to post as. Password hashes match the
-- dev seed (`adminpass` for the admin, `memberpass` for the member).
-- Applying this file is also how the suite resets itself: the comment rows it
-- wrote are deleted below, so a re-run starts from an empty queue.
--
-- public_id values are hard-coded in e2e/src/scenarios/comment-moderation.ts.
--   tenant   ModrTNNTAAA1 (moderate.localhost / admin.moderate.localhost)
--   label    ModrLABLAAA1
--   creator  ModrAUTHAAA1
--   series   ModrSERSAAA1
--   episode  ModrEPSDAAA1
--   admin    ModrADMNAAA1 (moderate-admin@example.com)
--   member   ModrMMBRAAA1 (moderate-member@example.com)

WITH tenant_seed AS (
    SELECT '018f0f70-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
SELECT
    ts.id,
    'ModrTNNTAAA1',
    'moderate.localhost',
    'admin.moderate.localhost',
    'Moderation Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

-- `approval_required`: a posted comment is stored pending and reaches nobody
-- but its author until staff approve it, which is the queue this suite works.
INSERT INTO tenant_config (tenant_id, comment_mode)
SELECT t.id, 'approval_required'
FROM tenants t
WHERE t.domain = 'moderate.localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET comment_mode = EXCLUDED.comment_mode,
    updated_at = NOW();

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'moderate.localhost'
),
label_seed AS (
    SELECT '018f0f71-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    ls.id AS label_id,
    ts.id AS tenant_id,
    'ModrLABLAAA1',
    'Moderation Label 01'
FROM label_seed ls
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'moderate.localhost'
),
creator_seed AS (
    SELECT '018f0f72-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    cs.id AS creator_id,
    ts.id AS tenant_id,
    'ModrAUTHAAA1',
    'Moderation Author 001',
    'Profile text for Moderation Author 001'
FROM creator_seed cs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    profile_text = EXCLUDED.profile_text;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'moderate.localhost'
)
INSERT INTO series (id, tenant_id, label_id, public_id, title, is_published, published_at)
SELECT
    '018f0f73-0001-7000-8000-000000000001'::uuid,
    ts.id AS tenant_id,
    l.id AS label_id,
    'ModrSERSAAA1',
    'Moderation Series 001',
    true,
    NOW() - INTERVAL '1 day'
FROM tenant_scope ts
JOIN labels l ON l.id = '018f0f71-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    title = EXCLUDED.title,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

INSERT INTO series_listings (series_id, synopsis, reading_period_hours, tenant_id)
SELECT
    s.id AS series_id,
    'Moderation series synopsis for Moderation Series 001',
    72,
    s.tenant_id
FROM series s
WHERE s.id = '018f0f73-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id) DO UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours,
    tenant_id = EXCLUDED.tenant_id;

INSERT INTO series_creators (series_id, creator_id, role, display_order, tenant_id)
SELECT
    s.id AS series_id,
    c.id AS creator_id,
    'author',
    1,
    s.tenant_id
FROM series s
JOIN creators c ON c.id = '018f0f72-0001-7000-8000-000000000001'::uuid
WHERE s.id = '018f0f73-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id, creator_id) DO UPDATE
SET role = EXCLUDED.role,
    display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    '018f0f74-0001-7000-8000-000000000001'::uuid,
    s.id AS series_id,
    'ModrEPSDAAA1',
    'Moderation Episode 001-01',
    1,
    s.tenant_id
FROM series s
WHERE s.id = '018f0f73-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

-- Free, so posting depends on the comment mode alone: a paid episode nobody
-- bought would refuse the post for a reason this suite is not about.
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
WHERE e.id = '018f0f74-0001-7000-8000-000000000001'::uuid
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;

WITH user_seed (id, public_id, email, password_hash, name) AS (
    VALUES
        (
            '018f0f75-0001-7000-8000-000000000001'::uuid,
            'ModrADMNAAA1',
            'moderate-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Moderation E2E Admin'
        ),
        (
            '018f0f75-0002-7000-8000-000000000002'::uuid,
            'ModrMMBRAAA1',
            'moderate-member@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Moderation E2E Member'
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
    email_verified_at
)
SELECT
    us.id,
    t.id,
    us.public_id,
    us.email,
    us.password_hash,
    us.name,
    'active',
    NOW()
FROM user_seed us
JOIN tenants t ON t.domain = 'moderate.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0f76-0001-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'ModrADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

-- The queue starts empty: the suite posts every comment it approves through
-- the site, so a leftover row would let an assertion pass without the round
-- trip having happened.
DELETE FROM episode_comments
WHERE episode_id = '018f0f74-0001-7000-8000-000000000001'::uuid;
