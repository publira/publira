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
-- e2e/tests/admin.screenshots.spec.ts,
-- e2e/tests/platform.screenshots.spec.ts, and the documentation's
-- e2e/tests/*.docs-screenshots.spec.ts.

BEGIN;

-- One day apart per series, so the order the catalogue and the console page
-- through stays what it was and no two rows share a date.
WITH numbered AS (
    SELECT
        s.id,
        RIGHT(s.title, 3)::int AS number
    FROM series s
        JOIN tenants t ON t.id = s.tenant_id
    WHERE t.public_id = 'SeedTNNTAAA1'
        AND s.title LIKE 'Seed Series %'
)
UPDATE series s
SET published_at = TIMESTAMPTZ '2026-01-05 09:00:00+00'
        + make_interval(days => numbered.number),
    updated_at = TIMESTAMPTZ '2026-01-05 09:00:00+00'
        + make_interval(days => numbered.number)
FROM numbered
WHERE s.id = numbered.id;

-- Six hours per episode after its series, the interval
-- db/seeds/dev/010_catalog.sql derives the same column from.
UPDATE episode_listings el
SET published_at = s.published_at + (e.order_index * INTERVAL '6 hours')
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN tenants t ON t.id = s.tenant_id
WHERE el.episode_id = e.id
    AND t.public_id = 'SeedTNNTAAA1'
    AND s.title LIKE 'Seed Series %'
    AND el.published_at IS NOT NULL;

-- The platform console prints when a tenant was created in the tenant list,
-- and reads the same column, plus the reader accounts and the operator roles,
-- for the dashboard's recent events. Addressed by the public_id the
-- development seed fixes, so a tenant a later spec creates keeps the real
-- timestamp that spec is about.
UPDATE tenants
SET created_at = TIMESTAMPTZ '2026-01-05 09:00:00+00'
WHERE public_id = 'SeedTNNTAAA1';

UPDATE users
SET created_at = TIMESTAMPTZ '2026-01-05 09:30:00+00'
WHERE public_id = 'SeedADMNAAA1';

UPDATE users
SET created_at = TIMESTAMPTZ '2026-01-05 10:00:00+00'
WHERE public_id = 'SeedMMBRAAA1';

-- A reader's page in the console prints when the address was confirmed.
UPDATE users
SET email_verified_at = created_at + INTERVAL '5 minutes'
WHERE public_id IN ('SeedADMNAAA1', 'SeedMMBRAAA1')
    AND email_verified_at IS NOT NULL;

UPDATE platform_user_roles pur
SET created_at = TIMESTAMPTZ '2026-01-05 08:00:00+00'
FROM platform_users pu
WHERE pu.id = pur.platform_user_id
    AND pu.public_id = 'SeedPFUSAAA1';

-- The audit log prints when each entry was recorded, and the development seed
-- spreads its fifty entries over the thirty days before it ran. The same
-- spread is kept, ending on a fixed day instead: an entry's number is the last
-- part of its id, the one db/seeds/dev/020_audit_logs.sql derives the offset
-- from.
WITH numbered AS (
    SELECT
        al.id,
        ('x' || RIGHT(al.id::text, 12))::bit(48)::bigint::int AS n
    FROM audit_logs al
        JOIN tenants t ON t.id = al.tenant_id
    WHERE t.public_id = 'SeedTNNTAAA1'
        AND al.id::text LIKE '018f0e74-%'
)
UPDATE audit_logs al
SET created_at = TIMESTAMPTZ '2026-05-01 00:00:00+00' - make_interval(
        days  => 30 - ((numbered.n - 1) / 2),
        hours => (numbered.n * 3) % 24,
        mins  => (numbered.n * 7) % 60
    )
FROM numbered
WHERE al.id = numbered.id;

-- The access ticket list prints when each ticket was issued.
UPDATE access_tickets at
SET created_at = TIMESTAMPTZ '2026-01-05 11:00:00+00'
FROM tenants t
WHERE t.id = at.tenant_id
    AND t.public_id = 'SeedTNNTAAA1'
    AND at.public_id = 'SeedTCKTAAA1';

-- The page list and a page's version history print when each page, each of
-- its translations, and each version was last written or published.
UPDATE pages p
SET created_at = TIMESTAMPTZ '2026-01-05 12:00:00+00',
    updated_at = TIMESTAMPTZ '2026-01-05 12:00:00+00'
FROM tenants t
WHERE t.id = p.tenant_id
    AND t.public_id = 'SeedTNNTAAA1';

UPDATE page_translations pt
SET created_at = TIMESTAMPTZ '2026-01-05 12:00:00+00',
    updated_at = TIMESTAMPTZ '2026-01-05 12:00:00+00'
FROM tenants t
WHERE t.id = pt.tenant_id
    AND t.public_id = 'SeedTNNTAAA1';

UPDATE page_versions pv
SET created_at = TIMESTAMPTZ '2026-01-05 12:00:00+00',
    published_at = CASE
        WHEN pv.published_at IS NULL THEN NULL
        ELSE TIMESTAMPTZ '2026-01-05 12:00:00+00'
    END
FROM tenants t
WHERE t.id = pv.tenant_id
    AND t.public_id = 'SeedTNNTAAA1';

COMMIT;
