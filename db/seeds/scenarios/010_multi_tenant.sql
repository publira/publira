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
    ls.id AS label_id,
    ts.id AS tenant_id,
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
    cs.id AS creator_id,
    ts.id AS tenant_id,
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
    ss.id AS series_id,
    ts.id AS tenant_id,
    l.id AS label_id,
    UPPER(SUBSTRING(REPLACE(ss.id::text, '-', '') FROM 1 FOR 12)),
    ss.title,
    ss.is_published,
    ss.published_at
FROM series_seed ss
CROSS JOIN tenant_scope ts
JOIN labels l ON l.id = '018f0f01-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    title = EXCLUDED.title,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

-- Fixture UUIDs rather than a title/tenant predicate: another scenario seed
-- adding rows to this tenant must not be picked up here.
INSERT INTO series_listings (series_id, synopsis, reading_period_hours, tenant_id)
SELECT
    s.id AS series_id,
    FORMAT('Boundary series synopsis for %s', s.title),
    72,
    s.tenant_id
FROM series s
WHERE s.id IN (
    '018f0f03-0001-7000-8000-000000000001'::uuid,
    '018f0f03-0002-7000-8000-000000000002'::uuid
)
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
JOIN creators c ON c.id = '018f0f02-0001-7000-8000-000000000001'::uuid
WHERE s.id IN (
    '018f0f03-0001-7000-8000-000000000001'::uuid,
    '018f0f03-0002-7000-8000-000000000002'::uuid
)
ON CONFLICT (series_id, creator_id) DO UPDATE
SET role = EXCLUDED.role,
    display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

WITH episode_seed (id, title, order_index) AS (
    VALUES
        ('018f0f04-0001-7000-8000-000000000001'::uuid, 'Boundary Episode 001-01', 1),
        ('018f0f04-0002-7000-8000-000000000002'::uuid, 'Boundary Episode 001-02', 2),
        ('018f0f04-0003-7000-8000-000000000003'::uuid, 'Boundary Episode 001-90', 90)
)
INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    es.id AS episode_id,
    s.id AS series_id,
    UPPER(SUBSTRING(REPLACE(es.id::text, '-', '') FROM 1 FOR 12)),
    es.title,
    es.order_index,
    s.tenant_id
FROM episode_seed es
JOIN series s ON s.id = '018f0f03-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

-- Episodes 01/02 are published; 90 stays scheduled so the catalog must hide it.
WITH listing_seed (episode_id, price, status, scheduled_at, published_at) AS (
    VALUES
        (
            '018f0f04-0001-7000-8000-000000000001'::uuid,
            0,
            'published',
            NULL::timestamptz,
            NOW() - INTERVAL '12 hours'
        ),
        (
            '018f0f04-0002-7000-8000-000000000002'::uuid,
            0,
            'published',
            NULL::timestamptz,
            NOW() - INTERVAL '6 hours'
        ),
        (
            '018f0f04-0003-7000-8000-000000000003'::uuid,
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
    e.id AS episode_id,
    ls.price,
    72,
    ls.status,
    ls.scheduled_at,
    ls.published_at,
    e.tenant_id
FROM listing_seed ls
JOIN episodes e ON e.id = ls.episode_id
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;
