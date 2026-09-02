-- Commerce: Episode purchases and the admin-issued access tickets that grant viewing
-- rights.

-- TABLE: purchases
CREATE TABLE purchases (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    price_at_purchase integer NOT NULL,
    expires_at timestamp with time zone,
    purchased_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL,
    -- Legacy/admin grants predate payment providers and leave this NULL.
    -- Stripe-created purchases always store a unique Checkout Session ID.
    stripe_checkout_session_id text
);

-- CONSTRAINT: purchases purchases_pkey
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);

-- CONSTRAINT: purchases purchases_stripe_checkout_session_id_key
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_stripe_checkout_session_id_key UNIQUE (stripe_checkout_session_id);

-- FK CONSTRAINT: purchases fk_purchases_tenant_id
ALTER TABLE ONLY purchases
    ADD CONSTRAINT fk_purchases_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: purchases purchases_episode_id_fkey
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id);

-- INDEX: idx_purchases_tenant_id
CREATE INDEX idx_purchases_tenant_id ON purchases USING btree (tenant_id);

-- INDEX: idx_purchases_tenant_user_purchased_at
-- Reader library keyset scans filter by tenant + user and run newest first.
CREATE INDEX idx_purchases_tenant_user_purchased_at ON purchases USING btree (tenant_id, user_id, purchased_at DESC, id DESC);

-- INDEX: idx_purchases_tenant_purchased_at_episode
-- Daily content stats scans one tenant's purchase source for a UTC day and
-- groups the result by episode.
CREATE INDEX idx_purchases_tenant_purchased_at_episode ON purchases USING btree (tenant_id, purchased_at DESC, episode_id);

-- ROW SECURITY: purchases
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- POLICY: purchases purchases_tenant_isolation
CREATE POLICY purchases_tenant_isolation ON purchases USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: access_tickets
-- Admin-issued viewing grants (ticket-style access, separate from purchases).
CREATE TABLE access_tickets (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    episode_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    note text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: access_tickets access_tickets_pkey
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_pkey PRIMARY KEY (id);

-- CONSTRAINT: access_tickets access_tickets_tenant_public_id_key
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- FK CONSTRAINT: access_tickets access_tickets_created_by_user_id_fkey
-- Single-column on purpose: multi-column FK with ON DELETE SET NULL would also null tenant_id.
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- FK CONSTRAINT: access_tickets access_tickets_tenant_id_fkey
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: access_tickets access_tickets_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: access_tickets access_tickets_tenant_user_id_fkey
-- Composite FK prevents referencing a user that belongs to another tenant.
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_access_tickets_active_user_episode
-- At most one non-revoked ticket per (tenant, user, episode). Concurrent issue is serialized by this unique partial index.
CREATE UNIQUE INDEX idx_access_tickets_active_user_episode ON access_tickets USING btree (tenant_id, user_id, episode_id) WHERE (revoked_at IS NULL);

-- INDEX: idx_access_tickets_tenant_created_at
CREATE INDEX idx_access_tickets_tenant_created_at ON access_tickets USING btree (tenant_id, created_at DESC, id DESC);

-- ROW SECURITY: access_tickets
ALTER TABLE access_tickets ENABLE ROW LEVEL SECURITY;

-- POLICY: access_tickets access_tickets_tenant_isolation
CREATE POLICY access_tickets_tenant_isolation ON access_tickets USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
