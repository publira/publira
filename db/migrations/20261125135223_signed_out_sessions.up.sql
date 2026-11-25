-- The sessions their holders have signed out of.
--
-- An access token is a signed claim rather than a row, so signing out changes
-- nothing about it: until it expires, a copy of the same token answers every
-- RPC the session could. The jti of a session that signed out is recorded
-- here, and the session checks refuse a token whose jti is.
--
-- Rows live no longer than the token they stand for, so expires_at carries
-- the token's own expiry and `job purge-mfa-challenges` deletes what is past
-- it.

-- TABLE: user_signed_out_sessions
-- A session of an account of a tenant, on the site or in the tenant console.
CREATE TABLE user_signed_out_sessions (
    jti uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    signed_out_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_signed_out_sessions user_signed_out_sessions_pkey
ALTER TABLE ONLY user_signed_out_sessions
    ADD CONSTRAINT user_signed_out_sessions_pkey PRIMARY KEY (jti);

-- FK CONSTRAINT: user_signed_out_sessions user_signed_out_sessions_tenant_user_id_fkey
ALTER TABLE ONLY user_signed_out_sessions
    ADD CONSTRAINT user_signed_out_sessions_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_user_signed_out_sessions_expires_at
CREATE INDEX idx_user_signed_out_sessions_expires_at ON user_signed_out_sessions USING btree (expires_at);

-- ROW SECURITY: user_signed_out_sessions
ALTER TABLE user_signed_out_sessions ENABLE ROW LEVEL SECURITY;

-- POLICY: user_signed_out_sessions user_signed_out_sessions_tenant_isolation
CREATE POLICY user_signed_out_sessions_tenant_isolation ON user_signed_out_sessions USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: platform_user_signed_out_sessions
-- A session of a platform operator, in the platform console.
CREATE TABLE platform_user_signed_out_sessions (
    jti uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    signed_out_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: platform_user_signed_out_sessions platform_user_signed_out_sessions_pkey
ALTER TABLE ONLY platform_user_signed_out_sessions
    ADD CONSTRAINT platform_user_signed_out_sessions_pkey PRIMARY KEY (jti);

-- FK CONSTRAINT: platform_user_signed_out_sessions platform_user_signed_out_sessions_platform_user_id_fkey
ALTER TABLE ONLY platform_user_signed_out_sessions
    ADD CONSTRAINT platform_user_signed_out_sessions_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- INDEX: idx_platform_user_signed_out_sessions_expires_at
CREATE INDEX idx_platform_user_signed_out_sessions_expires_at ON platform_user_signed_out_sessions USING btree (expires_at);
