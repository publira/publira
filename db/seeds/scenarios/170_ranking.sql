-- Scenario: ranking snapshots for the development seed tenant.
--
-- A tenant the engagement batch has run for is what the ranking page and the
-- top page's popularity module are about, and the development seed produces no
-- reading signals, so nothing computes one. These four rows are that batch's
-- output, written directly.
--
-- Two periods of each ranking, because a movement marker is the difference
-- between them. Together they cover every marker the page can draw: a series
-- that climbed, one that fell, one the earlier period did not rank at all, and
-- one that held its position.
--
-- Applied to the seed tenant rather than a tenant of its own, and by
-- `e2e/scripts/db-setup.sh` rather than by a spec, for the same reason
-- `160_screenshot_baseline.sql` is: the screenshot projects photograph the
-- state the stack was seeded with, before any suite has applied a scenario, so
-- the chart has to be there from the start. A tenant of its own would also
-- appear in the operator console's tenant list, which the platform baseline
-- records.
--
-- The seeded catalogue reaches `Seed Series 100`, and every date here is a
-- fixed literal just after the last one `160_screenshot_baseline.sql` writes
-- (2026-04-17), so the periods cover days the ranked series were already
-- published on. The tenant's zone is Asia/Tokyo and `computed_at` is
-- late-evening UTC, so the day the page prints is the following one.
--
-- The cold start — no snapshot, so the module keeps the recommendation shelf —
-- is the Boundary Tenant of `010_multi_tenant.sql`, which nothing ranks.

BEGIN;

-- The four snapshots. `items` carries only the two fields the ranking read
-- looks at; the batch writes the scores beside them, and nothing on the screen
-- shows a score.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
snapshot_seed (id, ranking_key, period_start, period_end, computed_at) AS (
    VALUES
        (
            '018f0f85-0001-7000-8000-000000000001'::uuid,
            'weekly',
            DATE '2026-04-12',
            DATE '2026-04-18',
            TIMESTAMPTZ '2026-04-19 21:00:00+00'
        ),
        (
            '018f0f85-0002-7000-8000-000000000002'::uuid,
            'weekly',
            DATE '2026-04-05',
            DATE '2026-04-11',
            TIMESTAMPTZ '2026-04-12 21:00:00+00'
        ),
        (
            '018f0f85-0003-7000-8000-000000000003'::uuid,
            'daily',
            DATE '2026-04-18',
            DATE '2026-04-18',
            TIMESTAMPTZ '2026-04-19 21:00:00+00'
        ),
        (
            '018f0f85-0004-7000-8000-000000000004'::uuid,
            'daily',
            DATE '2026-04-17',
            DATE '2026-04-17',
            TIMESTAMPTZ '2026-04-18 21:00:00+00'
        )
),

-- Each row is one position: which snapshot, which place, and the number in
-- `Seed Series NNN` that holds it. The markers the specs read off the screen
-- fall out of the difference between a period and the one before it:
--
--   weekly  042 1st, was 2nd   → up 1
--           100 2nd, unranked  → new
--           007 3rd, was 1st   → down 2
--   daily   100 1st, was 1st   → unchanged
--           099 3rd, unranked  → new
snapshot_item (snapshot_id, rank, series_number) AS (
    VALUES
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 1, 42),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 2, 100),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 3, 7),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 4, 63),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 5, 15),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 6, 99),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 7, 30),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 8, 58),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 9, 71),
        ('018f0f85-0001-7000-8000-000000000001'::uuid, 10, 87),
        ('018f0f85-0002-7000-8000-000000000002'::uuid, 1, 7),
        ('018f0f85-0002-7000-8000-000000000002'::uuid, 2, 42),
        ('018f0f85-0002-7000-8000-000000000002'::uuid, 3, 15),
        ('018f0f85-0002-7000-8000-000000000002'::uuid, 4, 30),
        ('018f0f85-0002-7000-8000-000000000002'::uuid, 5, 63),
        ('018f0f85-0002-7000-8000-000000000002'::uuid, 6, 58),
        ('018f0f85-0002-7000-8000-000000000002'::uuid, 7, 71),
        ('018f0f85-0002-7000-8000-000000000002'::uuid, 8, 99),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 1, 100),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 2, 42),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 3, 99),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 4, 7),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 5, 63),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 6, 15),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 7, 87),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 8, 30),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 9, 58),
        ('018f0f85-0003-7000-8000-000000000003'::uuid, 10, 71),
        ('018f0f85-0004-7000-8000-000000000004'::uuid, 1, 100),
        ('018f0f85-0004-7000-8000-000000000004'::uuid, 2, 7),
        ('018f0f85-0004-7000-8000-000000000004'::uuid, 3, 42),
        ('018f0f85-0004-7000-8000-000000000004'::uuid, 4, 63),
        ('018f0f85-0004-7000-8000-000000000004'::uuid, 5, 15),
        ('018f0f85-0004-7000-8000-000000000004'::uuid, 6, 30),
        ('018f0f85-0004-7000-8000-000000000004'::uuid, 7, 58),
        ('018f0f85-0004-7000-8000-000000000004'::uuid, 8, 71)
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
            jsonb_build_object('rank', si.rank, 'entity_id', s.id)
            ORDER BY si.rank
        )
        FROM snapshot_item si
        JOIN series s
            ON s.tenant_id = ts.id
            AND s.public_id = 'SeedSERS'
                || TRANSLATE(LPAD(si.series_number::text, 4, '0'), '0', 'A')
        WHERE si.snapshot_id = ss.id
    ), '[]'::jsonb),
    1,
    ss.computed_at
FROM snapshot_seed ss
CROSS JOIN tenant_scope ts
ON CONFLICT (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version) DO UPDATE
SET items = EXCLUDED.items,
    computed_at = EXCLUDED.computed_at;

COMMIT;
