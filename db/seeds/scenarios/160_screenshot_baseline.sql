-- Scenario: fixed timestamps for the screenshot baseline.
--
-- The development seed dates itself from the moment it runs. `Seed Series NNN`
-- is published somewhere within fifty days of today, and every tenant, reader,
-- and operator role is created "now". A screenshot of a screen that prints one
-- of those dates therefore stops matching its baseline the next day, or on the
-- next run, without anything about the screen having changed.
--
-- Rewriting them to fixed literals is what makes such a screen comparable. The
-- values are all in the past, which is the only property the rest of the suite
-- depends on: an episode is published when its `published_at` has passed, and
-- every date below has. Nothing asserts on a seeded date itself.
--
-- `e2e/scripts/db-setup.sh` applies this for every run rather than a spec
-- applying it for itself, so the dates the baseline recorded are the dates
-- every later suite reads as well.
--
-- Used by e2e/tests/host.screenshots.spec.ts,
-- e2e/tests/admin.screenshots.spec.ts, and
-- e2e/tests/platform.screenshots.spec.ts.

BEGIN;

-- One day apart per series, so the order the catalogue and the console page
-- through stays what it was and no two rows share a date.
WITH numbered AS (
    SELECT
        s.id,
        RIGHT(s.title, 3)::int AS number
    FROM series s
        JOIN tenants t ON t.id = s.tenant_id
    WHERE t.domain = 'localhost'
        AND s.title LIKE 'Seed Series %'
)
UPDATE series s
SET published_at = TIMESTAMPTZ '2026-01-05 09:00:00+09'
        + make_interval(days => numbered.number),
    updated_at = TIMESTAMPTZ '2026-01-05 09:00:00+09'
        + make_interval(days => numbered.number)
FROM numbered
WHERE s.id = numbered.id;

-- Six hours per episode after its series, the interval
-- db/seeds/dev/010_catalog.sql derives the same column from.
UPDATE episode_listings el
SET published_at = s.published_at + (e.order_index * INTERVAL '6 hours')
FROM episodes e
    JOIN series s ON s.id = e.series_id
WHERE el.episode_id = e.id
    AND s.title LIKE 'Seed Series %'
    AND el.published_at IS NOT NULL;

-- The platform console prints when a tenant was created in the tenant list,
-- and reads the same column, plus the reader accounts and the operator roles,
-- for the dashboard's recent events. Addressed by the public_id the
-- development seed fixes, so a tenant a later spec creates keeps the real
-- timestamp that spec is about.
UPDATE tenants
SET created_at = TIMESTAMPTZ '2026-01-05 09:00:00+09'
WHERE public_id = 'SeedTNNTAAA1';

UPDATE users
SET created_at = TIMESTAMPTZ '2026-01-05 09:30:00+09'
WHERE public_id = 'SeedADMNAAA1';

UPDATE users
SET created_at = TIMESTAMPTZ '2026-01-05 10:00:00+09'
WHERE public_id = 'SeedMMBRAAA1';

UPDATE platform_user_roles pur
SET created_at = TIMESTAMPTZ '2026-01-05 08:00:00+09'
FROM platform_users pu
WHERE pu.id = pur.platform_user_id
    AND pu.public_id = 'SeedPFUSAAA1';

COMMIT;
