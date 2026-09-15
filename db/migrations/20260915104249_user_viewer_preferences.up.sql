-- How a reader wants the viewer laid out, so the choice follows the account
-- rather than the browser it was made in.

-- TABLE: user_viewer_preferences
-- One row per reader, rewritten in place. The composite key is the identity of
-- the row and nothing points at it, so there is no surrogate key, the way
-- episode_reading_positions has none.
--
-- Every preference is a column with a default, and the default is what a reader
-- who has saved nothing reads back. That is what lets the next setting be a
-- column here rather than a second pair of RPCs, and it is why no column is
-- nullable: "unset" is not a state a reader can be in.
CREATE TABLE user_viewer_preferences (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    -- The viewer takes the full window width, giving back what the site header
    -- and the page gutters take from the page.
    wide_viewer_enabled boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_viewer_preferences user_viewer_preferences_pkey
ALTER TABLE ONLY user_viewer_preferences
    ADD CONSTRAINT user_viewer_preferences_pkey PRIMARY KEY (tenant_id, user_id);

-- FK CONSTRAINT: user_viewer_preferences user_viewer_preferences_tenant_user_id_fkey
-- Composite FK prevents referencing a user that belongs to another tenant.
ALTER TABLE ONLY user_viewer_preferences
    ADD CONSTRAINT user_viewer_preferences_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: user_viewer_preferences
ALTER TABLE user_viewer_preferences ENABLE ROW LEVEL SECURITY;

-- POLICY: user_viewer_preferences user_viewer_preferences_member_isolation
-- The member isolation episode_reading_positions uses: the row is the reader's
-- own state, so tenant isolation alone would let one member of the tenant read
-- and rewrite how another reads.
CREATE POLICY user_viewer_preferences_member_isolation ON user_viewer_preferences
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );
