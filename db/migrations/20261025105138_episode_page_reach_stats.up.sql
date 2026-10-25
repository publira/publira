-- How far into an episode its readers got, so the console can show the page at
-- which they leave it.
--
-- episode_reading_positions holds where each reader stands now and keeps no
-- history, and it is member-isolated, so a publira_admin connection sees none
-- of its rows. aggregate-content-stats files each tenant day of it here as
-- counts that name no reader, the way it files content_daily_stats.

-- TABLE: episode_page_reach_stats
-- One row per tenant day, episode, and page that a reader whose position was
-- last moved during that day reached: reader_count is those readers whose
-- position is at page_index or past it. The pages of an episode-day therefore
-- run from 0 to the furthest position without a gap, and the readers who left
-- at a page are its reader_count less the next page's.
--
-- A reader is counted on the day of their last move as the day stood when it
-- was rebuilt, since the position is rewritten in place. A reader who moves
-- on two days is counted on each, at the page they stopped at that day.
CREATE TABLE episode_page_reach_stats (
    tenant_id uuid NOT NULL,
    stat_date date NOT NULL,
    episode_id uuid NOT NULL,
    page_index integer NOT NULL,
    reader_count bigint NOT NULL,
    CONSTRAINT episode_page_reach_stats_page_index_check CHECK ((page_index >= 0)),
    -- A page nobody reached has no row rather than a 0, which is what keeps
    -- an episode-day to the pages up to its furthest position.
    CONSTRAINT episode_page_reach_stats_reader_count_check CHECK ((reader_count > 0))
);

-- CONSTRAINT: episode_page_reach_stats episode_page_reach_stats_pkey
-- Led by the episode, because the console reads one episode over a range of
-- days.
ALTER TABLE ONLY episode_page_reach_stats
    ADD CONSTRAINT episode_page_reach_stats_pkey PRIMARY KEY (tenant_id, episode_id, stat_date, page_index);

-- FK CONSTRAINT: episode_page_reach_stats episode_page_reach_stats_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY episode_page_reach_stats
    ADD CONSTRAINT episode_page_reach_stats_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_episode_page_reach_stats_tenant_date
-- The rows a rebuild of one tenant day replaces.
CREATE INDEX idx_episode_page_reach_stats_tenant_date ON episode_page_reach_stats USING btree (tenant_id, stat_date);

-- ROW SECURITY: episode_page_reach_stats
ALTER TABLE episode_page_reach_stats ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_page_reach_stats episode_page_reach_stats_tenant_isolation
CREATE POLICY episode_page_reach_stats_tenant_isolation ON episode_page_reach_stats
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
