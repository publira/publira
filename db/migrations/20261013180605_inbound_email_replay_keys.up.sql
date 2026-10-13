-- TABLE: inbound_email_replay_keys
-- The signed values that name one delivery for an inbound email provider whose
-- signature does not cover the mail it posts: a Mailgun Route post signs a
-- timestamp and a token, not the fields beside them. The first mail a key
-- arrives with is recorded by a digest of what was read from it, so a captured
-- signature cannot carry another mail while it is still accepted; a retry of
-- the same mail reads the same and passes. A key is claimed once per provider
-- rather than once per tenant: Mailgun's signing key is account-wide, so
-- tenants on one account verify each other's signatures, and a key claimed
-- under one tenant is refused under every other. A row is pruned once its key
-- could no longer verify.
CREATE TABLE inbound_email_replay_keys (
    tenant_id uuid NOT NULL,
    provider character varying(32) NOT NULL,
    replay_key text NOT NULL,
    -- SHA-256 of the mail as the provider read it, not of the request body,
    -- so a retry the provider encodes again still matches.
    content_sha256 bytea NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT inbound_email_replay_keys_replay_key_check CHECK (((length(replay_key) > 0) AND (length(replay_key) <= 256))),
    CONSTRAINT inbound_email_replay_keys_content_sha256_check CHECK ((length(content_sha256) = 32))
);

-- CONSTRAINT: inbound_email_replay_keys inbound_email_replay_keys_pkey
ALTER TABLE ONLY inbound_email_replay_keys
    ADD CONSTRAINT inbound_email_replay_keys_pkey PRIMARY KEY (provider, replay_key);

-- INDEX: inbound_email_replay_keys idx_inbound_email_replay_keys_tenant_received_at
CREATE INDEX idx_inbound_email_replay_keys_tenant_received_at ON inbound_email_replay_keys USING btree (tenant_id, received_at);

-- FK CONSTRAINT: inbound_email_replay_keys inbound_email_replay_keys_tenant_id_fkey
ALTER TABLE ONLY inbound_email_replay_keys
    ADD CONSTRAINT inbound_email_replay_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: inbound_email_replay_keys
ALTER TABLE inbound_email_replay_keys ENABLE ROW LEVEL SECURITY;

-- POLICY: inbound_email_replay_keys inbound_email_replay_keys_tenant_isolation
CREATE POLICY inbound_email_replay_keys_tenant_isolation ON inbound_email_replay_keys USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
