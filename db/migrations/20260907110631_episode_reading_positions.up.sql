-- Where a reader stopped inside an episode, so both viewers can reopen it
-- there instead of at page 1.

-- TABLE: episode_reading_positions
-- One row per reader and episode, rewritten in place every time the reader
-- moves. There is no history and no surrogate key: the composite key is the
-- identity of the position, and nothing outside this table points at a row.
-- That is what tells it apart from episode_reads, whose id exists because the
-- analytics projection files a read under it.
--
-- page_count is the number of pages the episode had when the position was
-- saved. It is stored rather than counted on read so the series and
-- "continue reading" surfaces can render progress from this row alone, and it
-- is refreshed on every save, so a reader who returns after new pages were
-- added carries the new count with their next move.
--
-- updated_at doubles as the ordering key of "what was this reader in the
-- middle of": the row is the reader's whole activity on the episode, and the
-- most recently moved one is the episode to offer them.
CREATE TABLE episode_reading_positions (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    page_index integer NOT NULL,
    page_count integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT episode_reading_positions_page_count_check CHECK ((page_count > 0)),
    -- page_index is zero-based, so the last page of the episode is
    -- page_count - 1. A position outside the episode would send the viewer to
    -- a page that does not exist.
    CONSTRAINT episode_reading_positions_page_index_check CHECK (((page_index >= 0) AND (page_index < page_count)))
);

-- CONSTRAINT: episode_reading_positions episode_reading_positions_pkey
ALTER TABLE ONLY episode_reading_positions
    ADD CONSTRAINT episode_reading_positions_pkey PRIMARY KEY (tenant_id, user_id, episode_id);

-- FK CONSTRAINT: episode_reading_positions episode_reading_positions_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY episode_reading_positions
    ADD CONSTRAINT episode_reading_positions_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_reading_positions episode_reading_positions_tenant_user_id_fkey
-- Composite FK prevents referencing a user that belongs to another tenant.
ALTER TABLE ONLY episode_reading_positions
    ADD CONSTRAINT episode_reading_positions_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_episode_reading_positions_tenant_user_updated_at
-- The reader's most recent activity, which is what the series call to action
-- and the "continue reading" row both start from. The primary key answers the
-- lookup of one episode already.
CREATE INDEX idx_episode_reading_positions_tenant_user_updated_at ON episode_reading_positions USING btree (tenant_id, user_id, updated_at DESC, episode_id DESC);

-- ROW SECURITY: episode_reading_positions
ALTER TABLE episode_reading_positions ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_reading_positions episode_reading_positions_member_isolation
-- The member isolation episode_reads uses: a position is the reader's own
-- state, so tenant isolation alone would let one member of the tenant read
-- where another stopped.
CREATE POLICY episode_reading_positions_member_isolation ON episode_reading_positions
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );
