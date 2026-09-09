-- Scenario: a tenant the ranking batch has already ranked
--
-- `host.ranking.spec.ts` reads positions, movement markers, and the two
-- periods off the screen. A ranking snapshot is tenant-wide and decides what
-- the top page's popularity module shows, so seeding one into the development
-- seed tenant would rewrite the module `catalog.browse.spec.ts` reads and the
-- home page `host.screenshots.spec.ts` compares pixel by pixel. This tenant
-- carries the snapshots instead.
--
-- Two periods of each ranking, because a movement marker is the difference
-- between them. Together they cover every marker the page can draw:
--
--   weekly  Ranking Series 002 1st, was 3rd  → up
--           Ranking Series 003 2nd, unranked → new
--           Ranking Series 001 3rd, was 1st  → down
--   daily   Ranking Series 001 1st, was 1st  → unchanged
--           Ranking Series 002 2nd, unranked → new
--
-- Every date here is a literal in the past: what the page prints is the
-- snapshot's `computed_at` in the tenant's time zone, and a value derived from
-- the moment the stack was seeded could not be asserted. The tenant's zone is
-- Asia/Tokyo while `computed_at` is late-evening UTC, so the printed calendar
-- day is the following one — which is what proves the conversion happened.
--
-- public_id values are hard-coded in e2e/src/scenarios/ranking.ts.
--   tenant   RankTNNTAAA1 (ranking.localhost / admin.ranking.localhost)
--   label    RankLABLAAA1
--   creator  RankAUTHAAA1
--   series   RankSERSAAA1 / RankSERSAAA2 / RankSERSAAA3
--   episodes RankEPSDAAA1 / RankEPSDAAA2 / RankEPSDAAA3

WITH tenant_seed AS (
    SELECT '018f0f80-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale, timezone)
SELECT
    ts.id,
    'RankTNNTAAA1',
    'ranking.localhost',
    'admin.ranking.localhost',
    'Ranking Tenant',
    'active',
    'en',
    'Asia/Tokyo'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale,
    timezone = EXCLUDED.timezone;

INSERT INTO tenant_config (
    tenant_id,
    copyright_text,
    site_description,
    site_tagline
)
SELECT
    t.id,
    '© Publira Ranking Tenant',
    'Public description text for Ranking Tenant.',
    'What everyone is reading.'
FROM tenants t
WHERE t.domain = 'ranking.localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET copyright_text = EXCLUDED.copyright_text,
    site_description = EXCLUDED.site_description,
    site_tagline = EXCLUDED.site_tagline,
    updated_at = NOW();

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'ranking.localhost'
),
label_seed AS (
    SELECT '018f0f81-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    ls.id AS label_id,
    ts.id AS tenant_id,
    'RankLABLAAA1',
    'Ranking Label 01'
FROM label_seed ls
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'ranking.localhost'
),
creator_seed AS (
    SELECT '018f0f82-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO creators (id, tenant_id, public_id, name, profile_text)
SELECT
    cs.id AS creator_id,
    ts.id AS tenant_id,
    'RankAUTHAAA1',
    'Ranking Author 001',
    'Profile text for Ranking Author 001'
FROM creator_seed cs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name,
    profile_text = EXCLUDED.profile_text;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'ranking.localhost'
),
series_seed (id, public_id, title, published_days_ago) AS (
    VALUES
        (
            '018f0f83-0001-7000-8000-000000000001'::uuid,
            'RankSERSAAA1',
            'Ranking Series 001',
            30
        ),
        (
            '018f0f83-0002-7000-8000-000000000002'::uuid,
            'RankSERSAAA2',
            'Ranking Series 002',
            20
        ),
        (
            '018f0f83-0003-7000-8000-000000000003'::uuid,
            'RankSERSAAA3',
            'Ranking Series 003',
            10
        )
)
INSERT INTO series (id, tenant_id, label_id, public_id, title, is_published, published_at)
SELECT
    ss.id,
    ts.id AS tenant_id,
    l.id AS label_id,
    ss.public_id,
    ss.title,
    true,
    NOW() - (ss.published_days_ago * INTERVAL '1 day')
FROM series_seed ss
CROSS JOIN tenant_scope ts
JOIN labels l ON l.id = '018f0f81-0001-7000-8000-000000000001'::uuid
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
    'Ranking series synopsis for ' || s.title,
    72,
    s.tenant_id
FROM series s
JOIN tenants t ON t.id = s.tenant_id
WHERE t.domain = 'ranking.localhost'
ON CONFLICT (series_id) DO UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours,
    tenant_id = EXCLUDED.tenant_id;

\ir ../creator_roles.sql

INSERT INTO series_creators (series_id, creator_id, role_id, display_order, tenant_id)
SELECT
    s.id AS series_id,
    c.id AS creator_id,
    cr.id,
    1,
    s.tenant_id
FROM series s
JOIN tenants t ON t.id = s.tenant_id
JOIN creators c ON c.id = '018f0f82-0001-7000-8000-000000000001'::uuid
JOIN creator_roles cr ON cr.tenant_id = s.tenant_id AND cr.name = 'Original Author'
WHERE t.domain = 'ranking.localhost'
ON CONFLICT (series_id, creator_id, role_id) DO UPDATE
SET display_order = EXCLUDED.display_order,
    tenant_id = EXCLUDED.tenant_id;

-- One free episode each, so every card on the chart leads somewhere a reader
-- can actually read, the way a series on the top page does.
WITH episode_seed (id, series_public_id, public_id, title) AS (
    VALUES
        (
            '018f0f84-0001-7000-8000-000000000001'::uuid,
            'RankSERSAAA1',
            'RankEPSDAAA1',
            'Ranking Episode 001-01'
        ),
        (
            '018f0f84-0002-7000-8000-000000000002'::uuid,
            'RankSERSAAA2',
            'RankEPSDAAA2',
            'Ranking Episode 002-01'
        ),
        (
            '018f0f84-0003-7000-8000-000000000003'::uuid,
            'RankSERSAAA3',
            'RankEPSDAAA3',
            'Ranking Episode 003-01'
        )
)
INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id)
SELECT
    es.id,
    s.id AS series_id,
    es.public_id,
    es.title,
    1,
    s.tenant_id
FROM episode_seed es
JOIN series s ON s.public_id = es.series_public_id
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    title = EXCLUDED.title,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

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
    NOW() - INTERVAL '5 days',
    e.tenant_id
FROM episodes e
JOIN tenants t ON t.id = e.tenant_id
WHERE t.domain = 'ranking.localhost'
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;

-- The snapshots themselves. `items` carries only the two fields the ranking
-- read looks at; the batch writes the scores beside them, and nothing on the
-- screen shows a score.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'ranking.localhost'
),
snapshot_seed (id, ranking_key, period_start, period_end, computed_at, first_series, second_series, third_series) AS (
    VALUES
        (
            '018f0f85-0001-7000-8000-000000000001'::uuid,
            'weekly',
            DATE '2026-03-19',
            DATE '2026-03-25',
            TIMESTAMPTZ '2026-03-26 21:00:00+00',
            'RankSERSAAA2',
            'RankSERSAAA3',
            'RankSERSAAA1'
        ),
        (
            '018f0f85-0002-7000-8000-000000000002'::uuid,
            'weekly',
            DATE '2026-03-12',
            DATE '2026-03-18',
            TIMESTAMPTZ '2026-03-19 21:00:00+00',
            'RankSERSAAA1',
            NULL,
            'RankSERSAAA2'
        ),
        (
            '018f0f85-0003-7000-8000-000000000003'::uuid,
            'daily',
            DATE '2026-03-25',
            DATE '2026-03-25',
            TIMESTAMPTZ '2026-03-26 21:00:00+00',
            'RankSERSAAA1',
            'RankSERSAAA2',
            NULL
        ),
        (
            '018f0f85-0004-7000-8000-000000000004'::uuid,
            'daily',
            DATE '2026-03-24',
            DATE '2026-03-24',
            TIMESTAMPTZ '2026-03-25 21:00:00+00',
            'RankSERSAAA1',
            'RankSERSAAA3',
            NULL
        )
)
INSERT INTO content_ranking_snapshots (
    id,
    tenant_id,
    ranking_key,
    period_start,
    period_end,
    entity_type,
    items,
    algorithm_version,
    computed_at
)
SELECT
    ss.id,
    ts.id AS tenant_id,
    ss.ranking_key,
    ss.period_start,
    ss.period_end,
    'series',
    COALESCE((
        SELECT jsonb_agg(
            jsonb_build_object('rank', entry.rank, 'entity_id', s.id)
            ORDER BY entry.rank
        )
        FROM (
            VALUES
                (1, ss.first_series),
                (2, ss.second_series),
                (3, ss.third_series)
        ) AS entry (rank, series_public_id)
        JOIN series s ON s.public_id = entry.series_public_id
    ), '[]'::jsonb),
    1,
    ss.computed_at
FROM snapshot_seed ss
CROSS JOIN tenant_scope ts
ON CONFLICT (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version) DO UPDATE
SET items = EXCLUDED.items,
    computed_at = EXCLUDED.computed_at;
