-- Push devices a reader's mobile app registered, so a member notification can
-- also reach the device it was written for.

-- TABLE: user_push_devices
-- One row per FCM registration token. The token is the identity: a build of
-- the app serves one tenant, and a token names one install of it, so a token
-- that comes back for another reader is the same phone in someone else's
-- hands and moves rather than multiplying.
CREATE TABLE user_push_devices (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    platform character varying(16) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_push_devices_platform_check CHECK (((platform)::text = ANY ((ARRAY['android'::character varying, 'ios'::character varying])::text[]))),
    CONSTRAINT user_push_devices_token_check CHECK ((char_length(token) > 0))
);

-- CONSTRAINT: user_push_devices user_push_devices_pkey
-- The token is unique on its own: FCM issues it per install, and the worker
-- deletes one FCM has answered for as revoked without knowing whose it was.
ALTER TABLE ONLY user_push_devices
    ADD CONSTRAINT user_push_devices_pkey PRIMARY KEY (token);

-- FK CONSTRAINT: user_push_devices user_push_devices_tenant_id_fkey
ALTER TABLE ONLY user_push_devices
    ADD CONSTRAINT user_push_devices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_push_devices user_push_devices_tenant_user_id_fkey
ALTER TABLE ONLY user_push_devices
    ADD CONSTRAINT user_push_devices_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_user_push_devices_tenant_user
-- The send path reads every device of the members a publish notified.
CREATE INDEX idx_user_push_devices_tenant_user ON user_push_devices USING btree (tenant_id, user_id);

-- ROW SECURITY: user_push_devices
-- Tenant-scoped API roles see only their tenant's rows; the outbox worker uses
-- a BYPASSRLS role and reads every token it has to send to.
ALTER TABLE user_push_devices ENABLE ROW LEVEL SECURITY;

-- POLICY: user_push_devices user_push_devices_tenant_isolation
CREATE POLICY user_push_devices_tenant_isolation ON user_push_devices USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
