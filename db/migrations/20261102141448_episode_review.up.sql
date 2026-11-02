-- A review step a tenant can put between saving an episode's publication time
-- and the scheduled publication job publishing it.

-- COLUMN: tenant_config episode_review_required
-- Off by default, so a tenant upgrading to a build that has this column keeps
-- publishing on the time alone, as it did before.
ALTER TABLE tenant_config
    ADD COLUMN episode_review_required boolean DEFAULT false NOT NULL;

-- COLUMN: episode_listings review_state
-- COLUMN: episode_listings review_approved_at
-- The latest decision on the episode, kept beside its status so the lists read
-- it without a join to every round: `in_review` while a round waits for a
-- Tenant admin, `approved` once one approved it, and `returned` once one sent
-- it back. NULL is an episode no round was opened for, which is every episode
-- written before these columns and every one written while review is off.
--
-- review_approved_at is what the scheduled publication job reads: with review
-- on, an episode is published only once it is set. It is set exactly while the
-- state is `approved`, so an edit that opens a new round clears it in the same
-- write.
ALTER TABLE episode_listings
    ADD COLUMN review_state text,
    ADD COLUMN review_approved_at timestamp with time zone;

ALTER TABLE episode_listings
    ADD CONSTRAINT episode_listings_review_state_check CHECK ((review_state = ANY (ARRAY['in_review'::text, 'approved'::text, 'returned'::text])));

ALTER TABLE episode_listings
    ADD CONSTRAINT episode_listings_review_approved_at_check CHECK (((review_approved_at IS NOT NULL) = (review_state IS NOT DISTINCT FROM 'approved'::text)));

-- TABLE: episode_reviews
-- One row is one round of review: an episode submitted, and the Tenant admin's
-- decision on it once there is one. Every round is kept, so the comments of an
-- episode sent back twice are both there to read; the episode's listing
-- carries the latest decision.
--
-- A round with no decision is open. At most one round of an episode is open,
-- which is the round a decision closes.
CREATE TABLE episode_reviews (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    submitted_by_user_id uuid,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    decision text,
    decided_by_user_id uuid,
    decided_at timestamp with time zone,
    comment text,
    CONSTRAINT episode_reviews_decision_check CHECK ((decision = ANY (ARRAY['approved'::text, 'returned'::text]))),
    -- A decision and its time are written together. Who made it is not part
    -- of the pair, because the foreign key clears it when the account is
    -- deleted and the decision stands.
    CONSTRAINT episode_reviews_decided_check CHECK (((decision IS NULL) = (decided_at IS NULL))),
    -- A return says what to fix.
    CONSTRAINT episode_reviews_returned_comment_check CHECK (((decision IS DISTINCT FROM 'returned'::text) OR (comment IS NOT NULL)))
);

-- CONSTRAINT: episode_reviews episode_reviews_pkey
ALTER TABLE ONLY episode_reviews
    ADD CONSTRAINT episode_reviews_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: episode_reviews episode_reviews_tenant_id_fkey
ALTER TABLE ONLY episode_reviews
    ADD CONSTRAINT episode_reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_reviews episode_reviews_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY episode_reviews
    ADD CONSTRAINT episode_reviews_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_reviews episode_reviews_tenant_submitted_by_user_id_fkey
-- FK CONSTRAINT: episode_reviews episode_reviews_tenant_decided_by_user_id_fkey
-- Composite, with SET NULL naming the one column, for the reason
-- episode_free_windows_tenant_created_by_user_id_fkey gives.
ALTER TABLE ONLY episode_reviews
    ADD CONSTRAINT episode_reviews_tenant_submitted_by_user_id_fkey FOREIGN KEY (tenant_id, submitted_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (submitted_by_user_id);

ALTER TABLE ONLY episode_reviews
    ADD CONSTRAINT episode_reviews_tenant_decided_by_user_id_fkey FOREIGN KEY (tenant_id, decided_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (decided_by_user_id);

-- INDEX: idx_episode_reviews_episode_submitted_at
-- One episode's rounds in the order they were submitted.
CREATE INDEX idx_episode_reviews_episode_submitted_at ON episode_reviews USING btree (episode_id, submitted_at, id);

-- INDEX: idx_episode_reviews_open_episode
-- The open round of an episode, and the guarantee that there is one at most.
CREATE UNIQUE INDEX idx_episode_reviews_open_episode ON episode_reviews USING btree (episode_id) WHERE (decision IS NULL);

-- INDEX: idx_episode_reviews_tenant_id
CREATE INDEX idx_episode_reviews_tenant_id ON episode_reviews USING btree (tenant_id);

-- ROW SECURITY: episode_reviews
ALTER TABLE episode_reviews ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_reviews episode_reviews_tenant_isolation
CREATE POLICY episode_reviews_tenant_isolation ON episode_reviews USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: episode_review_cleared
-- Whether review lets an episode of tenant_id be published: it is approved, or
-- its tenant does not require review. The scheduled publication job lists and
-- promotes an episode only when this answers true, and a tenant with no config
-- row requires none, as the column's default says.
CREATE FUNCTION episode_review_cleared(tenant_id uuid, review_approved_at timestamp with time zone) RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT episode_review_cleared.review_approved_at IS NOT NULL
        OR NOT COALESCE((
            SELECT tc.episode_review_required
            FROM tenant_config tc
            WHERE tc.tenant_id = episode_review_cleared.tenant_id
        ), false)
$$;
