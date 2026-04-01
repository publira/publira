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
INSERT INTO series_listings (series_id, synopsis, reading_period_hours, tenant_id)
SELECT
    s.id,
    FORMAT('Seed series synopsis for %s', s.public_id),
    72,
    s.tenant_id
FROM series s
JOIN tenant_scope ts ON ts.id = s.tenant_id
WHERE s.title LIKE 'Seed Series %'
ON CONFLICT (series_id) DO UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours,
    tenant_id = EXCLUDED.tenant_id;

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
INSERT INTO series_creators (series_id, creator_id, role, display_order, tenant_id)
SELECT
    ss.series_id,
    sc.creator_id,
    'author',
    1,
    s.tenant_id
FROM seed_series ss
JOIN seed_creators sc ON sc.creator_no = ss.series_no
JOIN series s ON s.id = ss.series_id
ON CONFLICT (series_id, creator_id) DO UPDATE
SET role = EXCLUDED.role,
    display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

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
INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    es.id,
    es.series_id,
    UPPER(SUBSTRING(REPLACE(es.id::text, '-', '') FROM 1 FOR 12)),
    FORMAT(
        'Seed Episode %s-%s',
        LPAD(es.series_no::text, 3, '0'),
        LPAD(es.ep_no::text, 2, '0')
    ),
    es.ep_no,
    s.tenant_id
FROM episode_seed es
JOIN series s ON s.id = es.series_id
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

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
    published_at,
    tenant_id
)
SELECT
    e.id,
    0,
    72,
    'published',
    NULL,
    s.published_at + (e.order_index::int * INTERVAL '6 hours'),
    s.tenant_id
FROM episodes e
JOIN series s ON s.id = e.series_id
JOIN tenant_scope ts ON ts.id = s.tenant_id
WHERE s.title LIKE 'Seed Series %'
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;
