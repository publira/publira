-- Scenario: multi tenant catalog boundary
--
-- Adds a second tenant (`other.localhost`) next to the dev seed tenant
-- (`localhost`). Everything is named `Boundary …` so E2E assertions can use
-- exact matches and never collide with the dev seed's `Seed …` records.
--
-- The catalog is intentionally small and deterministic:
--   - 1 published series with 2 published episodes (visible)
--   - 1 scheduled episode on that series (must stay hidden)
--   - 1 unpublished series (must stay hidden, detail must 404-equivalent)
--   - 1 page (the seed tenant's console must not be able to open it)
--
-- public_id is a fixed Base58 value in the same scheme as the dev seed (`Bndr`
-- instead of `Seed` for this scenario), so the values are stable and can be
-- hard-coded in tests (e2e/src/scenarios/multi-tenant.ts).
--   tenant   BndrTNNTAAA1
--   label    BndrLABLAAA1
--   creator  BndrAUTHAAA1
--   series   BndrSERSAAA1 (published) / BndrSERSAAA2 (unpublished)
--   episodes BndrEPSDAAA1 / BndrEPSDAAA2 (published), BndrEPSDAAA3 (scheduled)
--
-- A page has no public_id; it is addressed by its uuid, which is fixed here
-- as 018f0f05-0001-7000-8000-000000000001 for the same reason.
--
-- The tenant is on Asia/Tokyo, where the dev seed tenant and every process
-- that runs the suite are on UTC. A tenant whose day is not the server's day
-- is a real case, and this is the tenant the suite exercises it on.

WITH tenant_seed AS (
    SELECT '018f0f00-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, timezone, default_locale, supported_locales)
SELECT
    ts.id,
    'BndrTNNTAAA1',
    'other.localhost:' || :'tenant_port',
    'admin.other.localhost:' || :'tenant_port',
    'Boundary Tenant',
    'active',
    'Asia/Tokyo',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    timezone = EXCLUDED.timezone,
    default_locale = EXCLUDED.default_locale,
    supported_locales = EXCLUDED.supported_locales;

INSERT INTO tenant_config_translations (
    id,
    tenant_id,
    locale,
    copyright_text,
    site_description,
    site_tagline
)
SELECT
    uuidv7(),
    t.id,
    t.default_locale,
    '© Publira Boundary Tenant',
    'Public description text for Boundary Tenant.',
    'Nothing crosses the boundary.'
FROM tenants t
WHERE t.public_id = 'BndrTNNTAAA1'
ON CONFLICT (tenant_id, locale) DO UPDATE
SET copyright_text = EXCLUDED.copyright_text,
    site_description = EXCLUDED.site_description,
    site_tagline = EXCLUDED.site_tagline,
    updated_at = NOW();

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'BndrTNNTAAA1'
),
label_seed AS (
    SELECT '018f0f01-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    ls.id AS label_id,
    ts.id AS tenant_id,
    'BndrLABLAAA1',
    'Boundary Label 01'
FROM label_seed ls
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'BndrTNNTAAA1'
),
creator_seed AS (
    SELECT '018f0f02-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    cs.id AS creator_id,
    ts.id AS tenant_id,
    'BndrAUTHAAA1',
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
    WHERE t.public_id = 'BndrTNNTAAA1'
),
series_seed (id, public_id, is_published, published_at) AS (
    VALUES
        (
            '018f0f03-0001-7000-8000-000000000001'::uuid,
            'BndrSERSAAA1',
            true,
            NOW() - INTERVAL '1 day'
        ),
        (
            '018f0f03-0002-7000-8000-000000000002'::uuid,
            'BndrSERSAAA2',
            false,
            NULL::timestamptz
        )
)
INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    ss.id AS series_id,
    ts.id AS tenant_id,
    l.id AS label_id,
    ss.public_id,
    ss.is_published,
    ss.published_at
FROM series_seed ss
CROSS JOIN tenant_scope ts
JOIN labels l ON l.id = '018f0f01-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

-- Each series' title and synopsis, as its translation in the tenant's default
-- locale.
WITH translation_seed (id, series_id, title) AS (
    VALUES
        (
            '018f0f06-0001-7000-8000-000000000001'::uuid,
            '018f0f03-0001-7000-8000-000000000001'::uuid,
            'Boundary Series 001'
        ),
        (
            '018f0f06-0002-7000-8000-000000000002'::uuid,
            '018f0f03-0002-7000-8000-000000000002'::uuid,
            'Boundary Draft Series 900'
        )
)
INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    tr.id,
    s.id AS series_id,
    s.tenant_id,
    t.default_locale,
    tr.title,
    FORMAT('Boundary series synopsis for %s', tr.title)
FROM translation_seed tr
JOIN series s ON s.id = tr.series_id
JOIN tenants t ON t.id = s.tenant_id
ON CONFLICT (series_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    synopsis = EXCLUDED.synopsis;

-- Fixture UUIDs rather than a title/tenant predicate: another scenario seed
-- adding rows to this tenant must not be picked up here.
INSERT INTO series_listings (series_id, reading_period_hours, tenant_id)
SELECT
    s.id AS series_id,
    72,
    s.tenant_id
FROM series s
WHERE s.id IN (
    '018f0f03-0001-7000-8000-000000000001'::uuid,
    '018f0f03-0002-7000-8000-000000000002'::uuid
)
ON CONFLICT (series_id) DO UPDATE
SET reading_period_hours = EXCLUDED.reading_period_hours,
    tenant_id = EXCLUDED.tenant_id;

\set seed_tenant BndrTNNTAAA1
\ir ../creator_roles.sql

INSERT INTO series_creators (series_id, creator_id, role_id, display_order, tenant_id)
SELECT
    s.id AS series_id,
    c.id AS creator_id,
    cr.id,
    1,
    s.tenant_id
FROM series s
JOIN creators c ON c.id = '018f0f02-0001-7000-8000-000000000001'::uuid
JOIN creator_roles cr ON cr.tenant_id = s.tenant_id AND cr.name = 'Original Author'
WHERE s.id IN (
    '018f0f03-0001-7000-8000-000000000001'::uuid,
    '018f0f03-0002-7000-8000-000000000002'::uuid
)
ON CONFLICT (series_id, creator_id, role_id) DO UPDATE
SET display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

WITH episode_seed (id, public_id, order_index) AS (
    VALUES
        ('018f0f04-0001-7000-8000-000000000001'::uuid, 'BndrEPSDAAA1', 1),
        ('018f0f04-0002-7000-8000-000000000002'::uuid, 'BndrEPSDAAA2', 2),
        ('018f0f04-0003-7000-8000-000000000003'::uuid, 'BndrEPSDAAA3', 90)
)
INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    es.id AS episode_id,
    s.id AS series_id,
    es.public_id,
    es.order_index,
    s.tenant_id
FROM episode_seed es
JOIN series s ON s.id = '018f0f03-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

WITH translation_seed (id, episode_id, title) AS (
    VALUES
        ('018f0f07-0001-7000-8000-000000000001'::uuid, '018f0f04-0001-7000-8000-000000000001'::uuid, 'Boundary Episode 001-01'),
        ('018f0f07-0002-7000-8000-000000000002'::uuid, '018f0f04-0002-7000-8000-000000000002'::uuid, 'Boundary Episode 001-02'),
        ('018f0f07-0003-7000-8000-000000000003'::uuid, '018f0f04-0003-7000-8000-000000000003'::uuid, 'Boundary Episode 001-90')
)
INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    tr.id,
    e.id AS episode_id,
    e.tenant_id,
    t.default_locale,
    tr.title
FROM translation_seed tr
JOIN episodes e ON e.id = tr.episode_id
JOIN tenants t ON t.id = e.tenant_id
ON CONFLICT (episode_id, locale) DO UPDATE
SET title = EXCLUDED.title;

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

\ir ../episode_creators.sql

-- A page owned by this tenant, so the seed tenant's console can be asked to
-- open it by id. It stays a draft with no version: the edit screen must answer
-- the same way for a foreign page as for one that never existed.
WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.public_id = 'BndrTNNTAAA1'
    LIMIT 1
)
INSERT INTO pages (id, tenant_id, slug)
SELECT
    '018f0f05-0001-7000-8000-000000000001'::uuid,
    ts.tenant_id,
    '/boundary-page'
FROM tenant_scope ts
ON CONFLICT (tenant_id, slug) DO NOTHING;

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
SELECT
    '018f0f05-0002-7000-8000-000000000001'::uuid,
    p.id,
    p.tenant_id,
    t.default_locale,
    'Boundary Page 001'
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
WHERE t.public_id = 'BndrTNNTAAA1'
  AND p.slug = '/boundary-page'
ON CONFLICT (page_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    updated_at = NOW();
