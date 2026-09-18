-- Which surfaces — the web storefront, the mobile app, or both — a work may be
-- shown on.
--
-- The CHECK constraints are added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE locks without scanning either table; the next migration validates
-- them under a lock that lets reads and writes continue.

-- COLUMN: series availability
-- 'all' is both surfaces, 'web' the storefront alone, and 'app' the app alone.
-- The default is 'all' because that is where every series already in a
-- catalog is shown.
--
-- It sits on series next to is_published rather than on series_listings,
-- because it gates visibility the way publication does: a series with no
-- listing row still has to answer where it is shown.
ALTER TABLE ONLY series
    ADD COLUMN availability text DEFAULT 'all'::text NOT NULL,
    ADD CONSTRAINT series_availability_check CHECK ((availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;

-- COLUMN: episodes availability
-- One episode's override, and NULL where it follows its series, so a change to
-- the series reaches every episode that states nothing of its own. It sits on
-- episodes rather than episode_listings because the listing row is rewritten
-- whole on every schedule save.
ALTER TABLE ONLY episodes
    ADD COLUMN availability text,
    ADD CONSTRAINT episodes_availability_check CHECK ((availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;

-- VIEW: series_surfaces
-- One row per series and surface it may be shown on. A read names its surface
-- ('web' or 'app') and keeps the series that have a row for it.
--
-- security_invoker keeps the row-level security of series the caller's own;
-- without it the view would run with the rights of the role that applies
-- migrations, which bypasses RLS.
CREATE VIEW series_surfaces WITH (security_invoker = true) AS
SELECT s.id AS series_id,
    s.tenant_id,
    'web'::text AS surface
FROM series s
WHERE s.availability = ANY (ARRAY['all'::text, 'web'::text])
UNION ALL
SELECT s.id AS series_id,
    s.tenant_id,
    'app'::text AS surface
FROM series s
WHERE s.availability = ANY (ARRAY['all'::text, 'app'::text]);

-- VIEW: episode_surfaces
-- One row per episode and surface it may be shown on. The series is the upper
-- bound: an episode is shown only where its series is, and its own value can
-- narrow that but never widen it. Showing an episode where its series is not
-- would put that series on the surface through the episode read, which carries
-- it.
CREATE VIEW episode_surfaces WITH (security_invoker = true) AS
SELECT e.id AS episode_id,
    e.series_id,
    e.tenant_id,
    ss.surface
FROM episodes e
    JOIN series_surfaces ss ON ss.series_id = e.series_id
WHERE e.availability IS NULL
    OR e.availability = ANY (ARRAY['all'::text, ss.surface]);
