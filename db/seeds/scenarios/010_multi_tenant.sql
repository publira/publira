-- Scenario: multi tenant catalog boundary (#515)
--
-- Adds a second tenant (`other.localhost`) next to the dev seed tenant
-- (`localhost`). Everything is named `Boundary …` so E2E assertions can use
-- exact matches and never collide with the dev seed's `Seed …` records.
--
-- The catalog is intentionally small and deterministic:
--   - 1 published series with 2 published episodes (visible)
--   - 1 scheduled episode on that series (must stay hidden)
--   - 1 unpublished series (must stay hidden, detail must 404-equivalent)
--
-- public_id is derived from the UUID exactly like the dev seed, so the values
-- are stable and can be hard-coded in tests (e2e/src/scenarios/multi-tenant.ts).
--   tenant   018F0F000001
--   label    018F0F010001
--   creator  018F0F020001
--   series   018F0F030001 (published) / 018F0F030002 (unpublished)
--   episodes 018F0F040001 / 018F0F040002 (published), 018F0F040003 (scheduled)

WITH tenant_seed AS (
    SELECT '018f0f00-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status)
SELECT
    ts.id,
    UPPER(SUBSTRING(REPLACE(ts.id::text, '-', '') FROM 1 FOR 12)),
    'other.localhost',
    'admin.other.localhost',
    'Boundary Tenant',
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
    '© Publira Boundary Tenant',
    'Boundary Tenant の公開向け説明テキストです。',
    '境界を越えない。'
FROM tenants t
WHERE t.domain = 'other.localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET copyright_text = EXCLUDED.copyright_text,
    site_description = EXCLUDED.site_description,
    site_tagline = EXCLUDED.site_tagline,
    updated_at = NOW();

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'other.localhost'
),
label_seed AS (
    SELECT '018f0f01-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    ls.id,
    ts.id,
    UPPER(SUBSTRING(REPLACE(ls.id::text, '-', '') FROM 1 FOR 12)),
    'Boundary Label 01'
FROM label_seed ls
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'other.localhost'
),
creator_seed AS (
    SELECT '018f0f02-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    cs.id,
    ts.id,
    UPPER(SUBSTRING(REPLACE(cs.id::text, '-', '') FROM 1 FOR 12)),
    'Boundary Author 001',
    'Profile text for Boundary Author 001'
FROM creator_seed cs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    profile_text = EXCLUDED.profile_text;

-- Published series (visible) and unpublished series (hidden everywhere).
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'other.localhost'
),
series_seed (id, title, is_published, published_at) AS (
    VALUES
        (
            '018f0f03-0001-7000-8000-000000000001'::uuid,
            'Boundary Series 001',
            true,
            NOW() - INTERVAL '1 day'
        ),
        (
            '018f0f03-0002-7000-8000-000000000002'::uuid,
            'Boundary Draft Series 900',
            false,
            NULL::timestamptz
        )
)
INSERT INTO series (id, tenant_id, label_id, public_id, title, is_published, published_at)
SELECT
    ss.id,
    ts.id,
    l.id,
    UPPER(SUBSTRING(REPLACE(ss.id::text, '-', '') FROM 1 FOR 12)),
    ss.title,
    ss.is_published,
    ss.published_at
FROM series_seed ss
CROSS JOIN tenant_scope ts
JOIN labels l ON l.tenant_id = ts.id AND l.name = 'Boundary Label 01'
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
    WHERE t.domain = 'other.localhost'
)
INSERT INTO series_listings (series_id, synopsis, reading_period_hours, tenant_id)
SELECT
    s.id,
    FORMAT('Boundary series synopsis for %s', s.title),
    72,
    s.tenant_id
FROM series s
JOIN tenant_scope ts ON ts.id = s.tenant_id
WHERE s.title LIKE 'Boundary %'
ON CONFLICT (series_id) DO UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours,
    tenant_id = EXCLUDED.tenant_id;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'other.localhost'
)
INSERT INTO series_creators (series_id, creator_id, role, display_order, tenant_id)
SELECT
    s.id,
    c.id,
    'author',
    1,
    s.tenant_id
FROM series s
JOIN tenant_scope ts ON ts.id = s.tenant_id
JOIN creators c ON c.tenant_id = ts.id AND c.name = 'Boundary Author 001'
WHERE s.title LIKE 'Boundary %'
ON CONFLICT (series_id, creator_id) DO UPDATE
SET role = EXCLUDED.role,
    display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'other.localhost'
),
episode_seed (id, title, order_index) AS (
    VALUES
        ('018f0f04-0001-7000-8000-000000000001'::uuid, 'Boundary Episode 001-01', 1),
        ('018f0f04-0002-7000-8000-000000000002'::uuid, 'Boundary Episode 001-02', 2),
        ('018f0f04-0003-7000-8000-000000000003'::uuid, 'Boundary Episode 001-90', 90)
)
INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    es.id,
    s.id,
    UPPER(SUBSTRING(REPLACE(es.id::text, '-', '') FROM 1 FOR 12)),
    es.title,
    es.order_index,
    s.tenant_id
FROM episode_seed es
CROSS JOIN tenant_scope ts
JOIN series s ON s.tenant_id = ts.id AND s.title = 'Boundary Series 001'
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

-- Episodes 01/02 are published; 90 stays scheduled so the catalog must hide it.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'other.localhost'
),
listing_seed (title, price, status, scheduled_at, published_at) AS (
    VALUES
        (
            'Boundary Episode 001-01',
            0,
            'published',
            NULL::timestamptz,
            NOW() - INTERVAL '12 hours'
        ),
        (
            'Boundary Episode 001-02',
            0,
            'published',
            NULL::timestamptz,
            NOW() - INTERVAL '6 hours'
        ),
        (
            'Boundary Episode 001-90',
            0,
            'scheduled',
            NOW() + INTERVAL '7 days',
            NULL::timestamptz
        )
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
    ls.price,
    72,
    ls.status,
    ls.scheduled_at,
    ls.published_at,
    e.tenant_id
FROM listing_seed ls
CROSS JOIN tenant_scope ts
JOIN episodes e ON e.tenant_id = ts.id AND e.title = ls.title
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;
