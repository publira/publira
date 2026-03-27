BEGIN;

WITH tenant_seed AS (
    SELECT '018f0e6a-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status)
SELECT
    ts.id,
    UPPER(SUBSTRING(REPLACE(ts.id::text, '-', '') FROM 1 FOR 12)),
    'localhost',
    'admin.localhost',
    'Seed Tenant',
    'active'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_config (
    tenant_id,
    copyright_text,
    site_description,
    site_tagline
)
SELECT
    t.id,
    '© Publira Seed Tenant',
    'Seed Tenant の公開向け説明テキストです。',
    '読むたび、世界がひらく。'
FROM tenants t
WHERE t.domain = 'localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET copyright_text = EXCLUDED.copyright_text,
    site_description = EXCLUDED.site_description,
    site_tagline = EXCLUDED.site_tagline,
    updated_at = NOW();

WITH platform_user_seed AS (
    SELECT '018f0e6b-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
SELECT
    pus.id,
    UPPER(SUBSTRING(REPLACE(pus.id::text, '-', '') FROM 1 FOR 12)),
    'platform@example.com',
    '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
    'Platform Operator',
    'active'
FROM platform_user_seed pus
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    '018f0e6c-1000-7000-8000-000000000001'::uuid,
    pu.id,
    'platform_super_admin'
FROM platform_users pu
WHERE pu.email = 'platform@example.com'
ON CONFLICT (platform_user_id, role) DO NOTHING;

WITH admin_user_seed AS (
    SELECT '018f0e6d-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO users (id, tenant_id, public_id, email, password_hash, name, status)
SELECT
    aus.id,
    t.id,
    UPPER(SUBSTRING(REPLACE(aus.id::text, '-', '') FROM 1 FOR 12)),
    'admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Tenant Admin',
    'active'
FROM admin_user_seed aus
JOIN tenants t ON t.domain = 'localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_user_roles (id, user_id, role)
SELECT
    '018f0e6e-1000-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin'
FROM users u
WHERE u.email = 'admin@example.com'
ON CONFLICT (user_id, role) DO NOTHING;

WITH member_user_seed AS (
    SELECT '018f0e6f-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO users (id, tenant_id, public_id, email, password_hash, name, status)
SELECT
    mus.id,
    t.id,
    UPPER(SUBSTRING(REPLACE(mus.id::text, '-', '') FROM 1 FOR 12)),
    'member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Sample Member',
    'active'
FROM member_user_seed mus
JOIN tenants t ON t.domain = 'localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
label_seed AS (
    SELECT
        gs.n,
        (
            '018f0e70-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS id
    FROM GENERATE_SERIES(1, 10) AS gs(n)
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    ls.id,
    ts.id,
    UPPER(SUBSTRING(REPLACE(ls.id::text, '-', '') FROM 1 FOR 12)),
    FORMAT('Seed Label %s', LPAD(ls.n::text, 2, '0'))
FROM label_seed ls
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
creator_seed AS (
    SELECT
        gs.n,
        (
            '018f0e71-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS id
    FROM GENERATE_SERIES(1, 100) AS gs(n)
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    cs.id,
    ts.id,
    UPPER(SUBSTRING(REPLACE(cs.id::text, '-', '') FROM 1 FOR 12)),
    FORMAT('Seed Author %s', LPAD(cs.n::text, 3, '0')),
    FORMAT('Profile text for Seed Author %s', LPAD(cs.n::text, 3, '0'))
FROM creator_seed cs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    profile_text = EXCLUDED.profile_text;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
label_pool AS (
    SELECT
        l.id,
        ROW_NUMBER() OVER (ORDER BY l.public_id) AS label_no
    FROM labels l
    JOIN tenant_scope ts ON ts.id = l.tenant_id
    WHERE l.name LIKE 'Seed Label %'
),
series_seed AS (
    SELECT
        gs.n,
        (
            '018f0e72-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS id,
        ((gs.n - 1) % 10) + 1 AS label_no
    FROM GENERATE_SERIES(1, 100) AS gs(n)
)
INSERT INTO series (id, tenant_id, label_id, public_id, title, is_published, published_at)
SELECT
    ss.id,
    ts.id,
    lp.id,
    UPPER(SUBSTRING(REPLACE(ss.id::text, '-', '') FROM 1 FOR 12)),
    FORMAT('Seed Series %s', LPAD(ss.n::text, 3, '0')),
    true,
    NOW()
    - make_interval(
        days => 30 + (GET_BYTE(DECODE(MD5(ss.id::text), 'hex'), 0) % 120),
        hours => GET_BYTE(DECODE(MD5(ss.id::text), 'hex'), 1) % 24,
        mins => GET_BYTE(DECODE(MD5(ss.id::text), 'hex'), 2) % 60
    )
FROM series_seed ss
JOIN label_pool lp ON lp.label_no = ss.label_no
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    title = EXCLUDED.title,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
)
INSERT INTO series_listings (series_id, synopsis, reading_period_hours)
SELECT
    s.id,
    FORMAT('Seed series synopsis for %s', s.public_id),
    72
FROM series s
JOIN tenant_scope ts ON ts.id = s.tenant_id
WHERE s.title LIKE 'Seed Series %'
ON CONFLICT (series_id) DO UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.id AS series_id,
        ROW_NUMBER() OVER (ORDER BY s.public_id) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
seed_creators AS (
    SELECT
        c.id AS creator_id,
        ROW_NUMBER() OVER (ORDER BY c.public_id) AS creator_no
    FROM creators c
    JOIN tenant_scope ts ON ts.id = c.tenant_id
    WHERE c.name LIKE 'Seed Author %'
)
INSERT INTO series_creators (series_id, creator_id, role, display_order)
SELECT
    ss.series_id,
    sc.creator_id,
    'author',
    1
FROM seed_series ss
JOIN seed_creators sc ON sc.creator_no = ss.series_no
ON CONFLICT (series_id, creator_id) DO UPDATE
SET role = EXCLUDED.role,
    display_order = EXCLUDED.display_order;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
seed_series AS (
    SELECT
        s.id,
        ROW_NUMBER() OVER (ORDER BY s.public_id) AS series_no
    FROM series s
    JOIN tenant_scope ts ON ts.id = s.tenant_id
    WHERE s.title LIKE 'Seed Series %'
),
episode_seed AS (
    SELECT
        ss.id AS series_id,
        ss.series_no,
        ep.ep_no,
        ((ss.series_no - 1) * 10 + ep.ep_no) AS seq_no,
        (
            '018f0e73-'
            || LPAD(TO_HEX(((ss.series_no - 1) * 10 + ep.ep_no)), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(((ss.series_no - 1) * 10 + ep.ep_no)), 12, '0')
        )::uuid AS id
    FROM seed_series ss
    CROSS JOIN GENERATE_SERIES(1, 10) AS ep(ep_no)
)
INSERT INTO episodes (id, series_id, public_id, title, order_index)
SELECT
    es.id,
    es.series_id,
    UPPER(SUBSTRING(REPLACE(es.id::text, '-', '') FROM 1 FOR 12)),
    FORMAT(
        'Seed Episode %s-%s',
        LPAD(es.series_no::text, 3, '0'),
        LPAD(es.ep_no::text, 2, '0')
    ),
    es.ep_no
FROM episode_seed es
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
)
INSERT INTO episode_listings (
    episode_id,
    price,
    reading_period_hours,
    status,
    scheduled_at,
    published_at
)
SELECT
    e.id,
    0,
    72,
    'published',
    NULL,
    s.published_at + (e.order_index::int * INTERVAL '6 hours')
FROM episodes e
JOIN series s ON s.id = e.series_id
JOIN tenant_scope ts ON ts.id = s.tenant_id
WHERE s.title LIKE 'Seed Series %'
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at;

-- 監査ログ（50件）
-- actor: admin@example.com (tenant_admin), member@example.com (member) を交互に使用
-- series / episode / label / creator に対する各種アクション
WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
admin_user AS (
    SELECT u.id AS user_id
    FROM users u
    WHERE u.email = 'admin@example.com'
),
member_user AS (
    SELECT u.id AS user_id
    FROM users u
    WHERE u.email = 'member@example.com'
),
audit_data(n, action, target_type, actor_role) AS (
    VALUES
        (1,  'series_created',                   'series',  'tenant_admin'),
        (2,  'series_updated',                   'series',  'tenant_admin'),
        (3,  'series_created',                   'series',  'tenant_admin'),
        (4,  'episode_created',                  'episode', 'tenant_admin'),
        (5,  'episode_created',                  'episode', 'tenant_admin'),
        (6,  'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (7,  'series_updated',                   'series',  'member'),
        (8,  'episode_created',                  'episode', 'tenant_admin'),
        (9,  'label_created',                    'label',   'tenant_admin'),
        (10, 'label_updated',                    'label',   'tenant_admin'),
        (11, 'creator_created',                  'creator', 'tenant_admin'),
        (12, 'creator_updated',                  'creator', 'tenant_admin'),
        (13, 'series_created',                   'series',  'tenant_admin'),
        (14, 'episode_created',                  'episode', 'tenant_admin'),
        (15, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (16, 'series_updated',                   'series',  'member'),
        (17, 'series_created',                   'series',  'tenant_admin'),
        (18, 'episode_created',                  'episode', 'tenant_admin'),
        (19, 'label_created',                    'label',   'tenant_admin'),
        (20, 'creator_created',                  'creator', 'tenant_admin'),
        (21, 'series_updated',                   'series',  'tenant_admin'),
        (22, 'episode_created',                  'episode', 'tenant_admin'),
        (23, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (24, 'series_created',                   'series',  'tenant_admin'),
        (25, 'creator_updated',                  'creator', 'member'),
        (26, 'series_updated',                   'series',  'tenant_admin'),
        (27, 'episode_created',                  'episode', 'tenant_admin'),
        (28, 'label_updated',                    'label',   'tenant_admin'),
        (29, 'series_created',                   'series',  'tenant_admin'),
        (30, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (31, 'episode_created',                  'episode', 'tenant_admin'),
        (32, 'series_updated',                   'series',  'member'),
        (33, 'creator_created',                  'creator', 'tenant_admin'),
        (34, 'series_created',                   'series',  'tenant_admin'),
        (35, 'label_created',                    'label',   'tenant_admin'),
        (36, 'episode_created',                  'episode', 'tenant_admin'),
        (37, 'series_updated',                   'series',  'tenant_admin'),
        (38, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (39, 'creator_updated',                  'creator', 'tenant_admin'),
        (40, 'series_created',                   'series',  'tenant_admin'),
        (41, 'episode_created',                  'episode', 'tenant_admin'),
        (42, 'label_updated',                    'label',   'tenant_admin'),
        (43, 'series_updated',                   'series',  'member'),
        (44, 'episode_created',                  'episode', 'tenant_admin'),
        (45, 'series_created',                   'series',  'tenant_admin'),
        (46, 'episode_publish_schedule_updated', 'episode', 'tenant_admin'),
        (47, 'creator_created',                  'creator', 'tenant_admin'),
        (48, 'series_updated',                   'series',  'tenant_admin'),
        (49, 'label_created',                    'label',   'tenant_admin'),
        (50, 'episode_created',                  'episode', 'tenant_admin')
)
INSERT INTO audit_logs (
    id,
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    outcome,
    client_ip,
    created_at
)
SELECT
    (
        '018f0e74-'
        || LPAD(TO_HEX(ad.n), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(ad.n), 12, '0')
    )::uuid,
    ts.tenant_id,
    CASE
        WHEN ad.actor_role = 'member' THEN mu.user_id
        ELSE au.user_id
    END,
    ad.actor_role,
    ad.action,
    ad.target_type,
    FORMAT('seed-target-%s', LPAD(ad.n::text, 3, '0')),
    -- n=7,16,25,32,43 は失敗、それ以外は成功
    CASE WHEN ad.n IN (7, 16, 25, 32, 43) THEN 'failure' ELSE 'success' END,
    FORMAT('192.168.1.%s', (ad.n % 10) + 1),
    NOW() - make_interval(
        days  => 30 - ((ad.n - 1) / 2),
        hours => (ad.n * 3) % 24,
        mins  => (ad.n * 7) % 60
    )
FROM audit_data ad
CROSS JOIN tenant_scope ts
CROSS JOIN admin_user au
CROSS JOIN member_user mu
ON CONFLICT (id) DO UPDATE
SET action      = EXCLUDED.action,
    target_type = EXCLUDED.target_type,
    target_id   = EXCLUDED.target_id,
    outcome     = EXCLUDED.outcome,
    client_ip   = EXCLUDED.client_ip,
    created_at  = EXCLUDED.created_at;

COMMIT;