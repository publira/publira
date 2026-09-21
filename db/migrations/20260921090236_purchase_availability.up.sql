-- Which surfaces — the web storefront, the mobile app, or both — an episode may
-- be bought on, and where a reader is sent to buy it in the app.
--
-- The CHECK constraints are added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE locks without scanning any table; the next migration validates them
-- under a lock that lets reads and writes continue.

-- COLUMN: tenant_config purchase_availability
-- The tenant's default, in the values series.availability takes. 'all' is what
-- every tenant sells on today, so it is the default and a tenant with no config
-- row reads as it.
ALTER TABLE ONLY tenant_config
    ADD COLUMN purchase_availability text DEFAULT 'all'::text NOT NULL,
    ADD CONSTRAINT tenant_config_purchase_availability_check CHECK ((purchase_availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;

-- COLUMN: tenant_config app_store_url, google_play_url
-- The store listings of the tenant's app, and NULL where it has none there.
ALTER TABLE ONLY tenant_config
    ADD COLUMN app_store_url text,
    ADD COLUMN google_play_url text,
    ADD CONSTRAINT tenant_config_app_store_url_check CHECK (((app_store_url IS NULL) OR (app_store_url ~ '^https://[^[:space:]]+$'::text))) NOT VALID,
    ADD CONSTRAINT tenant_config_google_play_url_check CHECK (((google_play_url IS NULL) OR (google_play_url ~ '^https://[^[:space:]]+$'::text))) NOT VALID;

-- COLUMN: series purchase_availability
-- The series' override of the tenant default, and NULL where it follows it. It
-- sits on series next to availability rather than on series_listings, which
-- every console save rewrites whole.
ALTER TABLE ONLY series
    ADD COLUMN purchase_availability text,
    ADD CONSTRAINT series_purchase_availability_check CHECK ((purchase_availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;

-- COLUMN: episodes purchase_availability
-- One episode's override of its series, and NULL where it follows it.
ALTER TABLE ONLY episodes
    ADD COLUMN purchase_availability text,
    ADD CONSTRAINT episodes_purchase_availability_check CHECK ((purchase_availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;

-- VIEW: episode_purchase_availability
-- One row per episode with where it may be bought: its own value, else its
-- series', else the tenant's. Unlike episode_surfaces each level replaces the
-- one above rather than bounding it, so an episode can be sold where its series
-- is not.
--
-- security_invoker keeps the row-level security of the tables the caller's own;
-- without it the view would run with the rights of the role that applies
-- migrations, which bypasses RLS.
CREATE VIEW episode_purchase_availability WITH (security_invoker = true) AS
SELECT e.id AS episode_id,
    e.tenant_id,
    COALESCE(e.purchase_availability, s.purchase_availability, tc.purchase_availability, 'all'::text) AS purchase_availability
FROM episodes e
    JOIN series s ON s.id = e.series_id
    LEFT JOIN tenant_config tc ON tc.tenant_id = e.tenant_id;
