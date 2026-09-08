-- Scheduled free windows: a period during which a priced episode reads as free
-- to everyone, without changing episode_listings.price. The price is what the
-- episode costs again once the window closes, so a campaign never has to be
-- undone by restoring a number an editor has to remember.

-- btree_gist supplies the equality operator class the exclusion constraint
-- below needs for episode_id: gist alone cannot compare uuids.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- TABLE: episode_free_windows
-- One row is one campaign period on one episode. Both ends are absolute
-- instants: an editor picks them in the tenant's own time zone and the console
-- converts, which keeps a window that ends "Sunday midnight" ending at the same
-- moment for every reader regardless of where they are.
--
-- The row is deleted rather than cancelled. A window that is over is not a
-- record anyone reads back — audit_logs keeps who scheduled and who removed
-- one — and keeping expired rows would only make the exclusion constraint and
-- the access predicates scan more.
CREATE TABLE episode_free_windows (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    episode_id uuid NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    -- When the apply-free-windows batch dropped the public site caches for each
    -- end of the window. NULL means that boundary has not been applied yet, so
    -- a batch that was down over a boundary still catches up on its next pass
    -- instead of leaving a closed window served from cache.
    start_revalidated_at timestamp with time zone,
    end_revalidated_at timestamp with time zone,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Half-open [starts_at, ends_at): the end instant is already outside the
    -- window, which is what lets two windows meet without overlapping.
    CONSTRAINT episode_free_windows_period_check CHECK ((ends_at > starts_at))
);

-- CONSTRAINT: episode_free_windows episode_free_windows_pkey
ALTER TABLE ONLY episode_free_windows
    ADD CONSTRAINT episode_free_windows_pkey PRIMARY KEY (id);

-- CONSTRAINT: episode_free_windows episode_free_windows_tenant_public_id_key
ALTER TABLE ONLY episode_free_windows
    ADD CONSTRAINT episode_free_windows_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- CONSTRAINT: episode_free_windows episode_free_windows_no_overlap
-- At most one window covers any instant of an episode. Two overlapping windows
-- would answer the same question twice and make "free until" ambiguous, so the
-- database refuses them rather than leaving the reads to pick a winner.
ALTER TABLE ONLY episode_free_windows
    ADD CONSTRAINT episode_free_windows_no_overlap EXCLUDE USING gist (
        episode_id WITH =,
        tstzrange(starts_at, ends_at) WITH &&
    );

-- FK CONSTRAINT: episode_free_windows episode_free_windows_tenant_id_fkey
ALTER TABLE ONLY episode_free_windows
    ADD CONSTRAINT episode_free_windows_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_free_windows episode_free_windows_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY episode_free_windows
    ADD CONSTRAINT episode_free_windows_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_free_windows episode_free_windows_tenant_created_by_user_id_fkey
-- Composite FK prevents naming a scheduler from another tenant. SET NULL lists
-- created_by_user_id so the reference can stay composite: without the column
-- list the action would null tenant_id too, and the row would lose the tenant
-- its isolation policy filters on. Deleting the account therefore leaves the
-- window scheduled, and audit_logs keeps who scheduled it.
ALTER TABLE ONLY episode_free_windows
    ADD CONSTRAINT episode_free_windows_tenant_created_by_user_id_fkey FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by_user_id);

-- INDEX: idx_episode_free_windows_episode_period
-- The access predicates ask one episode whether now falls inside a window. The
-- exclusion constraint's gist index answers range overlap, but a btree on the
-- two instants is what makes that lookup a plain index scan.
CREATE INDEX idx_episode_free_windows_episode_period ON episode_free_windows USING btree (episode_id, starts_at, ends_at);

-- INDEX: idx_episode_free_windows_pending_boundaries
-- The apply-free-windows batch, which reads only the rows with a boundary it
-- has not applied yet. Both columns are null for a window that is still ahead
-- of its start, so the partial index stays about as small as the work queue.
CREATE INDEX idx_episode_free_windows_pending_boundaries ON episode_free_windows USING btree (starts_at, ends_at)
    WHERE ((start_revalidated_at IS NULL) OR (end_revalidated_at IS NULL));

-- INDEX: idx_episode_free_windows_tenant_id
CREATE INDEX idx_episode_free_windows_tenant_id ON episode_free_windows USING btree (tenant_id);

-- ROW SECURITY: episode_free_windows
ALTER TABLE episode_free_windows ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_free_windows episode_free_windows_tenant_isolation
CREATE POLICY episode_free_windows_tenant_isolation ON episode_free_windows USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
