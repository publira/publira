-- Credits on the episode, baked from the series when the episode is created.
--
-- series_creators was the only place a credit could live, so a series whose
-- artist changed at episode 12 had one answer for all of them. The episode is
-- the unit a reader opens and the unit a guest is credited on, so it is the
-- unit that carries credits.
--
-- The rows are copied rather than inherited. A team change is the common
-- event, and it must not need per-episode work: editing the series changes
-- what the next episode is created with and leaves the ones already out
-- alone. The trade-off is that a correction on the series does not reach
-- past episodes, which is what a range edit across episodes is for.

-- TABLE: episode_creators
CREATE TABLE episode_creators (
    tenant_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    -- Nullable for the reason series_creators.role_id is: a credit written
    -- before the tenant had a role vocabulary states none, and the back-fill
    -- below copies it as it is rather than dropping a credit it cannot label.
    role_id uuid,
    display_order integer DEFAULT 0 NOT NULL,
    -- Where the credit came from: `series` for a row this table baked from
    -- series_creators, `episode` for one an editor added on the episode
    -- itself. It is what tells a guest on episode 7 apart from the standing
    -- team, which is the difference a range edit has to respect.
    source text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT episode_creators_source_check CHECK ((source IN ('series', 'episode')))
);

-- CONSTRAINT: episode_creators episode_creators_episode_id_creator_id_role_id_key
-- One person may hold two roles on the same episode — an original author who
-- also draws it is two credits — and may not hold the same one twice. It is a
-- unique constraint rather than a primary key because a primary key cannot
-- hold a nullable column, and NULLS NOT DISTINCT is what still keeps a
-- role-less credit from being written twice.
ALTER TABLE ONLY episode_creators
    ADD CONSTRAINT episode_creators_episode_id_creator_id_role_id_key UNIQUE NULLS NOT DISTINCT (episode_id, creator_id, role_id);

-- FK CONSTRAINT: episode_creators episode_creators_tenant_id_fkey
ALTER TABLE ONLY episode_creators
    ADD CONSTRAINT episode_creators_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_creators episode_creators_tenant_episode_id_fkey
-- Composite FK prevents crediting on an episode of another tenant.
ALTER TABLE ONLY episode_creators
    ADD CONSTRAINT episode_creators_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_creators episode_creators_tenant_creator_id_fkey
-- Composite FK prevents crediting a creator of another tenant.
ALTER TABLE ONLY episode_creators
    ADD CONSTRAINT episode_creators_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_creators episode_creators_tenant_role_id_fkey
-- No ON DELETE clause, for the reason series_creators has none: a role a
-- credit still names is not something the database drops on its own, which is
-- what makes deleting a role in use a refusal the console can explain rather
-- than a silent loss of the credit.
ALTER TABLE ONLY episode_creators
    ADD CONSTRAINT episode_creators_tenant_role_id_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES creator_roles(tenant_id, id);

-- INDEX: idx_episode_creators_tenant_creator
-- The read that starts from the person: which episodes someone is credited on.
-- The unique constraint starts at episode_id and serves the other direction.
CREATE INDEX idx_episode_creators_tenant_creator ON episode_creators USING btree (tenant_id, creator_id);

-- INDEX: idx_episode_creators_tenant_role
-- The read that starts from the role: the check that refuses to delete one a
-- credit still names.
CREATE INDEX idx_episode_creators_tenant_role ON episode_creators USING btree (tenant_id, role_id, episode_id);

-- ROW SECURITY: episode_creators
ALTER TABLE episode_creators ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_creators episode_creators_tenant_isolation
CREATE POLICY episode_creators_tenant_isolation ON episode_creators USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- Back-fill: every episode that already exists is credited the way its series
-- is. Without it an episode published before this table would answer with no
-- credits at all, and the storefront reads the episode's own rows with no
-- fallback to the series. `source` is `series` because that is exactly what
-- these rows are: the series' team, baked at the moment the table appeared.
INSERT INTO episode_creators (tenant_id, episode_id, creator_id, role_id, display_order, source)
SELECT e.tenant_id,
    e.id,
    sc.creator_id,
    sc.role_id,
    sc.display_order,
    'series'
FROM episodes e
    JOIN series_creators sc ON sc.series_id = e.series_id;
