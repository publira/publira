-- Admin MFA: the TOTP secret a tenant member enrolled, and the one-time
-- recovery codes that stand in for the authenticator when it is unavailable.
-- Both tables are keyed by the user and carry tenant_id so the tenant
-- isolation policies of the identity domain apply to them too.

-- TABLE: user_mfa_totp
-- One row per account, created when enrollment starts. enabled_at stays NULL
-- until the account proves it can read a code off the authenticator, so an
-- abandoned enrollment never becomes a factor the account is challenged for.
-- A second method (WebAuthn) would be a table of its own beside this one
-- rather than a column in it.
CREATE TABLE user_mfa_totp (
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    secret_encrypted text NOT NULL,
    enabled_at timestamp with time zone,
    -- The last time step a code was accepted for. RFC 6238 section 5.2 asks
    -- that a code be usable once, and the window is wider than one step.
    last_verified_step bigint,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_mfa_totp user_mfa_totp_pkey
ALTER TABLE ONLY user_mfa_totp
    ADD CONSTRAINT user_mfa_totp_pkey PRIMARY KEY (user_id);

-- FK CONSTRAINT: user_mfa_totp user_mfa_totp_tenant_user_id_fkey
ALTER TABLE ONLY user_mfa_totp
    ADD CONSTRAINT user_mfa_totp_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: user_mfa_totp
ALTER TABLE user_mfa_totp ENABLE ROW LEVEL SECURITY;

-- POLICY: user_mfa_totp user_mfa_totp_tenant_isolation
CREATE POLICY user_mfa_totp_tenant_isolation ON user_mfa_totp USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_mfa_recovery_codes
-- Codes are shown once at generation and stored as bcrypt hashes, so a spent
-- code is recognisable and an unspent one is not readable out of the table.
-- Used rows are kept rather than deleted: the count of what is left is what
-- the console shows, and a replayed code has to be told from an unknown one.
CREATE TABLE user_mfa_recovery_codes (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    code_hash text NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_mfa_recovery_codes user_mfa_recovery_codes_pkey
ALTER TABLE ONLY user_mfa_recovery_codes
    ADD CONSTRAINT user_mfa_recovery_codes_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: user_mfa_recovery_codes user_mfa_recovery_codes_tenant_user_id_fkey
ALTER TABLE ONLY user_mfa_recovery_codes
    ADD CONSTRAINT user_mfa_recovery_codes_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_user_mfa_recovery_codes_user_created_at
CREATE INDEX idx_user_mfa_recovery_codes_user_created_at ON user_mfa_recovery_codes USING btree (user_id, created_at);

-- ROW SECURITY: user_mfa_recovery_codes
ALTER TABLE user_mfa_recovery_codes ENABLE ROW LEVEL SECURITY;

-- POLICY: user_mfa_recovery_codes user_mfa_recovery_codes_tenant_isolation
CREATE POLICY user_mfa_recovery_codes_tenant_isolation ON user_mfa_recovery_codes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
