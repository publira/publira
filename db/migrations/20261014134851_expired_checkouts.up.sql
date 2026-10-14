-- The checkout a reader last let expire, per episode.
--
-- A checkout is started under an idempotency key derived from the request, so
-- that a retried request reuses the checkout the provider already made rather
-- than opening a second one. A provider keeps answering that key with the
-- checkout it first made for as long as it remembers the key, which can
-- outlast the checkout itself: a reader who comes back to an episode after
-- their checkout expired would be sent to the expired one again. The key
-- therefore also names the checkout recorded here, so it changes once the
-- provider reports the reader's checkout expired.

-- TABLE: expired_checkouts
-- One row per reader and episode, holding only the latest expiry: the key
-- needs to change once per expiry, not to remember every one, and a repeated
-- delivery of the same expiry names the same checkout and so leaves the key as
-- it is.
CREATE TABLE expired_checkouts (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    provider text NOT NULL,
    provider_checkout_id text NOT NULL,
    expired_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: expired_checkouts expired_checkouts_pkey
ALTER TABLE ONLY expired_checkouts
    ADD CONSTRAINT expired_checkouts_pkey PRIMARY KEY (tenant_id, user_id, episode_id);

-- FK CONSTRAINT: expired_checkouts expired_checkouts_tenant_id_fkey
ALTER TABLE ONLY expired_checkouts
    ADD CONSTRAINT expired_checkouts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: expired_checkouts expired_checkouts_tenant_user_id_fkey
-- Composite FK prevents referencing a reader that belongs to another tenant.
ALTER TABLE ONLY expired_checkouts
    ADD CONSTRAINT expired_checkouts_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: expired_checkouts expired_checkouts_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY expired_checkouts
    ADD CONSTRAINT expired_checkouts_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_expired_checkouts_tenant_episode_id
-- The referencing side of the episode foreign key: deleting an episode would
-- otherwise scan every reader's row.
CREATE INDEX idx_expired_checkouts_tenant_episode_id ON expired_checkouts USING btree (tenant_id, episode_id);

-- ROW SECURITY: expired_checkouts
ALTER TABLE expired_checkouts ENABLE ROW LEVEL SECURITY;

-- POLICY: expired_checkouts expired_checkouts_tenant_isolation
CREATE POLICY expired_checkouts_tenant_isolation ON expired_checkouts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
