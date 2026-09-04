-- Reader comments on published episodes, and the tenant setting that decides
-- how a posted comment reaches the public site.

-- TABLE: episode_comments
-- One flat list per episode. Every row answers the episode directly, which is
-- why the only parent it names is episode_id.
--
-- The row carries its whole moderation history in the transition columns
-- rather than in a separate state table: published_at is when the comment
-- first became publicly readable, hidden_at / hidden_by / hidden_reason are the
-- removal currently in force, and withdrawn_at is the author's own deletion.
-- A removal is reversible, so hidden_at is cleared when staff restore the
-- comment; published_at is not, because a restored comment goes back to the
-- moment it was already public. audit_logs, not this table, is the append-only
-- record of who did each of those things and why.
--
-- A withdrawn row is kept rather than deleted. Staff can still read a comment
-- its author removed while a report or a dispute about it is open, and the
-- retention purge is what finally deletes it.
CREATE TABLE episode_comments (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    episode_id uuid NOT NULL,
    user_id uuid NOT NULL,
    body text NOT NULL,
    status character varying(20) NOT NULL,
    approved_by uuid,
    hidden_by uuid,
    hidden_reason character varying(16),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    hidden_at timestamp with time zone,
    withdrawn_at timestamp with time zone,
    CONSTRAINT episode_comments_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'published'::character varying, 'hidden'::character varying, 'withdrawn'::character varying])::text[]))),
    -- An automatic removal has no staff actor to name, so hidden_by stays null
    -- for it. hidden_reason is what tells the two kinds of removal apart,
    -- because a staff actor can be deleted afterwards and leave hidden_by null.
    CONSTRAINT episode_comments_hidden_reason_check CHECK (
        (hidden_reason IS NULL)
        OR (((hidden_reason)::text = 'staff'::text) OR (((hidden_reason)::text = 'auto_reports'::text) AND (hidden_by IS NULL)))
    ),
    -- A pending comment was never public, and a published one always is; the
    -- two removed states keep whichever of the two they came from, so staff
    -- reading a hidden or withdrawn row still see when it went public.
    CONSTRAINT episode_comments_published_at_check CHECK (
        (((status)::text <> 'pending'::text) OR (published_at IS NULL))
        AND (((status)::text <> 'published'::text) OR (published_at IS NOT NULL))
    ),
    -- The removal columns describe a removal in force, so they are required by
    -- 'hidden' and empty in every other state: a restore clears them.
    CONSTRAINT episode_comments_hidden_at_check CHECK (
        CASE
            WHEN ((status)::text = 'hidden'::text) THEN ((hidden_at IS NOT NULL) AND (hidden_reason IS NOT NULL))
            ELSE ((hidden_at IS NULL) AND (hidden_by IS NULL) AND (hidden_reason IS NULL))
        END
    ),
    -- Withdrawal is the author's own deletion and is terminal, so a row cannot
    -- claim to be withdrawn without a withdrawn_at, nor carry one otherwise.
    CONSTRAINT episode_comments_withdrawn_at_check CHECK ((((status)::text = 'withdrawn'::text) = (withdrawn_at IS NOT NULL)))
);

-- CONSTRAINT: episode_comments episode_comments_pkey
ALTER TABLE ONLY episode_comments
    ADD CONSTRAINT episode_comments_pkey PRIMARY KEY (id);

-- CONSTRAINT: episode_comments episode_comments_tenant_public_id_key
ALTER TABLE ONLY episode_comments
    ADD CONSTRAINT episode_comments_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- FK CONSTRAINT: episode_comments episode_comments_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY episode_comments
    ADD CONSTRAINT episode_comments_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_comments episode_comments_tenant_user_id_fkey
-- Composite FK prevents referencing a user that belongs to another tenant.
ALTER TABLE ONLY episode_comments
    ADD CONSTRAINT episode_comments_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_comments episode_comments_tenant_approved_by_fkey
-- Composite FK prevents naming a moderator from another tenant. SET NULL lists
-- approved_by so the reference can stay composite: without the column list the
-- action would null tenant_id too, and the row would lose the tenant its
-- isolation policy filters on. Deleting a staff account therefore leaves the
-- comment approved and published, and audit_logs keeps who approved it.
ALTER TABLE ONLY episode_comments
    ADD CONSTRAINT episode_comments_tenant_approved_by_fkey FOREIGN KEY (tenant_id, approved_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (approved_by);

-- FK CONSTRAINT: episode_comments episode_comments_tenant_hidden_by_fkey
-- Composite and SET NULL for the same reasons as approved_by. A removal whose
-- actor has since been deleted keeps hidden_reason 'staff', which is what tells
-- it from the automatic removal that never had an actor.
ALTER TABLE ONLY episode_comments
    ADD CONSTRAINT episode_comments_tenant_hidden_by_fkey FOREIGN KEY (tenant_id, hidden_by) REFERENCES users(tenant_id, id) ON DELETE SET NULL (hidden_by);

-- INDEX: idx_episode_comments_tenant_episode_status_created_at
-- The public list of one episode.
CREATE INDEX idx_episode_comments_tenant_episode_status_created_at ON episode_comments USING btree (tenant_id, episode_id, status, created_at DESC, id);

-- INDEX: idx_episode_comments_tenant_status_created_at
-- The moderation and approval queues, which span every episode of the tenant.
CREATE INDEX idx_episode_comments_tenant_status_created_at ON episode_comments USING btree (tenant_id, status, created_at DESC, id);

-- INDEX: idx_episode_comments_tenant_user_created_at
-- The viewer's own comments, and the per-reader rate limit that counts the
-- most recent of them.
CREATE INDEX idx_episode_comments_tenant_user_created_at ON episode_comments USING btree (tenant_id, user_id, created_at DESC);

-- INDEX: idx_episode_comments_tenant_withdrawn_at
-- The retention purge. Restricted to withdrawn rows because they are the only
-- ones it deletes, and they are a small minority of the table.
CREATE INDEX idx_episode_comments_tenant_withdrawn_at ON episode_comments USING btree (tenant_id, withdrawn_at) WHERE ((status)::text = 'withdrawn'::text);

-- ROW SECURITY: episode_comments
ALTER TABLE episode_comments ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_comments episode_comments_tenant_isolation
-- Tenant isolation rather than the member isolation of episode_follows: a
-- comment is read by every visitor of the episode, not only by its author.
CREATE POLICY episode_comments_tenant_isolation ON episode_comments USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: tenant_config comment_mode
-- Whether readers can comment on this tenant's episodes at all, and whether a
-- posted comment is public immediately or waits for staff approval. It
-- defaults to disabled so a tenant that already exists opts in deliberately
-- rather than gaining a public writing surface on deploy.
ALTER TABLE tenant_config
    ADD COLUMN comment_mode text DEFAULT 'disabled'::text NOT NULL;

ALTER TABLE tenant_config
    ADD CONSTRAINT tenant_config_comment_mode_check CHECK ((comment_mode = ANY (ARRAY['disabled'::text, 'immediate'::text, 'approval_required'::text])));
