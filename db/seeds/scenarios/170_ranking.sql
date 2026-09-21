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
-- The periods end on the tenant's own yesterday as of when this file is
-- applied, and the tenant's daily_rebuild_progress is recorded as having got
-- that far. The worker rebuilds the rankings from the stored signals on its
-- own, so a seeded period older than its last pass would sit behind the empty
-- snapshot that pass writes; recorded this way, its first pass finds nothing
-- to do. No screen shows the periods, so the screenshots do not move with them.
--
-- The cold start — no snapshot, so the module keeps the recommendation shelf —
-- is the Boundary Tenant of `010_multi_tenant.sql`, which has no signals to rank.

BEGIN;

-- The four snapshots. `items` carries only the two fields the ranking read
-- looks at; the batch writes the scores beside them, and nothing on the screen
-- shows a score.
WITH tenant_scope AS (
    SELECT t.id, (now() AT TIME ZONE t.timezone)::date - 1 AS yesterday
    FROM tenants t
    WHERE t.domain = 'localhost'
),
-- computed_at stays a literal because the site prints it, and the snapshot
-- with the latest one is the one it reads.
snapshot_seed (snapshot, ranking_key, start_offset, end_offset, computed_at) AS (
    VALUES
        ('weekly-current', 'weekly', 6, 0, TIMESTAMPTZ '2026-04-20 06:00:00+00'),
        ('weekly-previous', 'weekly', 13, 7, TIMESTAMPTZ '2026-04-13 06:00:00+00'),
        ('daily-current', 'daily', 0, 0, TIMESTAMPTZ '2026-04-20 06:00:00+00'),
        ('daily-previous', 'daily', 1, 1, TIMESTAMPTZ '2026-04-19 06:00:00+00')
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
snapshot_item (snapshot, rank, series_number) AS (
    VALUES
        ('weekly-current', 1, 42),
        ('weekly-current', 2, 100),
        ('weekly-current', 3, 7),
        ('weekly-current', 4, 63),
        ('weekly-current', 5, 15),
        ('weekly-current', 6, 99),
        ('weekly-current', 7, 30),
        ('weekly-current', 8, 58),
        ('weekly-current', 9, 71),
        ('weekly-current', 10, 87),
        ('weekly-previous', 1, 7),
        ('weekly-previous', 2, 42),
        ('weekly-previous', 3, 15),
        ('weekly-previous', 4, 30),
        ('weekly-previous', 5, 63),
        ('weekly-previous', 6, 58),
        ('weekly-previous', 7, 71),
        ('weekly-previous', 8, 99),
        ('daily-current', 1, 100),
        ('daily-current', 2, 42),
        ('daily-current', 3, 99),
        ('daily-current', 4, 7),
        ('daily-current', 5, 63),
        ('daily-current', 6, 15),
        ('daily-current', 7, 87),
        ('daily-current', 8, 30),
        ('daily-current', 9, 58),
        ('daily-current', 10, 71),
        ('daily-previous', 1, 100),
        ('daily-previous', 2, 7),
        ('daily-previous', 3, 42),
        ('daily-previous', 4, 63),
        ('daily-previous', 5, 15),
        ('daily-previous', 6, 30),
        ('daily-previous', 7, 58),
        ('daily-previous', 8, 71)
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
    uuidv7(),
    ts.id AS tenant_id,
    ss.ranking_key,
    ts.yesterday - ss.start_offset,
    ts.yesterday - ss.end_offset,
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
        WHERE si.snapshot = ss.snapshot
    ), '[]'::jsonb),
    1,
    ss.computed_at
FROM snapshot_seed ss
CROSS JOIN tenant_scope ts
ON CONFLICT (tenant_id, ranking_key, period_start, period_end, entity_type, algorithm_version) DO UPDATE
SET items = EXCLUDED.items,
    computed_at = EXCLUDED.computed_at;

-- The chain has got as far as the snapshots above, for every link.
INSERT INTO daily_rebuild_progress (
    tenant_id, episode_reads_projected_at, content_stats_through, rankings_through, recommend_features_through
)
SELECT t.id, now(), d.yesterday, d.yesterday, d.yesterday
FROM tenants t
CROSS JOIN LATERAL (SELECT (now() AT TIME ZONE t.timezone)::date - 1 AS yesterday) d
WHERE t.domain = 'localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET episode_reads_projected_at = GREATEST(daily_rebuild_progress.episode_reads_projected_at, EXCLUDED.episode_reads_projected_at),
    content_stats_through = GREATEST(daily_rebuild_progress.content_stats_through, EXCLUDED.content_stats_through),
    rankings_through = GREATEST(daily_rebuild_progress.rankings_through, EXCLUDED.rankings_through),
    recommend_features_through = GREATEST(daily_rebuild_progress.recommend_features_through, EXCLUDED.recommend_features_through),
    updated_at = now();

COMMIT;
