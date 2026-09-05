-- Scenario: a tenant that takes reader comments
--
-- `host.episode-comments.spec.ts` posts comments, deletes them, and removes one
-- the way staff would. `tenant_config.comment_mode` is one setting for a whole
-- tenant, so a suite that turns commenting on cannot share a tenant with the
-- ones reading the dev seed's episode pages: the section would appear under
-- every episode `host.episode-reading` and `host.viewer-performance` open.
--
-- Two members, because the point of the suite is what one reader sees of
-- another reader's comment. Password hashes match the dev seed (`memberpass`).
-- Applying this file is also how the suite resets itself: the comment rows it
-- wrote are deleted below, so a re-run starts from an empty list.
--
-- public_id values are hard-coded in e2e/src/scenarios/episode-comments.ts.
--   tenant   CmntTNNTAAA1 (comment.localhost / admin.comment.localhost)
--   label    CmntLABLAAA1
--   creator  CmntAUTHAAA1
--   series   CmntSERSAAA1
--   episode  CmntEPSDAAA1
--   members  CmntMMBRAAA1 (the author) / CmntMMBRAAA2 (the other reader)

WITH tenant_seed AS (
    SELECT '018f0f60-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
SELECT
    ts.id,
    'CmntTNNTAAA1',
    'comment.localhost',
    'admin.comment.localhost',
    'Comment Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

-- `immediate`: a posted comment is public straight away, which is what lets the
-- suite read one reader's comment back from another reader's browser without
-- an approval step in between.
INSERT INTO tenant_config (tenant_id, comment_mode)
SELECT t.id, 'immediate'
FROM tenants t
WHERE t.domain = 'comment.localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET comment_mode = EXCLUDED.comment_mode,
    updated_at = NOW();

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'comment.localhost'
),
label_seed AS (
    SELECT '018f0f61-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    ls.id AS label_id,
    ts.id AS tenant_id,
    'CmntLABLAAA1',
    'Comment Label 01'
FROM label_seed ls
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'comment.localhost'
),
creator_seed AS (
    SELECT '018f0f62-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    cs.id AS creator_id,
    ts.id AS tenant_id,
    'CmntAUTHAAA1',
    'Comment Author 001',
    'Profile text for Comment Author 001'
FROM creator_seed cs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    profile_text = EXCLUDED.profile_text;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'comment.localhost'
)
INSERT INTO series (id, tenant_id, label_id, public_id, title, is_published, published_at)
SELECT
    '018f0f63-0001-7000-8000-000000000001'::uuid,
    ts.id AS tenant_id,
    l.id AS label_id,
    'CmntSERSAAA1',
    'Comment Series 001',
    true,
    NOW() - INTERVAL '1 day'
FROM tenant_scope ts
JOIN labels l ON l.id = '018f0f61-0001-7000-8000-000000000001'::uuid
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
    'Comment series synopsis for Comment Series 001',
    72,
    s.tenant_id
FROM series s
WHERE s.id = '018f0f63-0001-7000-8000-000000000001'::uuid
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
JOIN creators c ON c.id = '018f0f62-0001-7000-8000-000000000001'::uuid
WHERE s.id = '018f0f63-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id, creator_id) DO UPDATE
SET role = EXCLUDED.role,
    display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    '018f0f64-0001-7000-8000-000000000001'::uuid,
    s.id AS series_id,
    'CmntEPSDAAA1',
    'Comment Episode 001-01',
    1,
    s.tenant_id
FROM series s
WHERE s.id = '018f0f63-0001-7000-8000-000000000001'::uuid
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
WHERE e.id = '018f0f64-0001-7000-8000-000000000001'::uuid
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;

WITH member_seed (id, public_id, email, name) AS (
    VALUES
        (
            '018f0f65-0001-7000-8000-000000000001'::uuid,
            'CmntMMBRAAA1',
            'comment-author@example.com',
            'Comment E2E Author'
        ),
        (
            '018f0f65-0002-7000-8000-000000000002'::uuid,
            'CmntMMBRAAA2',
            'comment-reader@example.com',
            'Comment E2E Reader'
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
    ms.id,
    t.id,
    ms.public_id,
    ms.email,
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    ms.name,
    'active',
    NOW()
FROM member_seed ms
JOIN tenants t ON t.domain = 'comment.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

-- The list starts empty: the suite writes every comment it asserts on through
-- the form, so a leftover row would let an assertion pass without the round
-- trip having happened.
DELETE FROM episode_comments
WHERE episode_id = '018f0f64-0001-7000-8000-000000000001'::uuid;
