-- Passkeys: WebAuthn credentials a tenant's account answers a second-factor
-- challenge with, the ceremonies that register and assert them, and the
-- failure counter both second factors now share.

-- TABLE: user_webauthn_credentials
-- One row per registered credential. rp_id is the relying party ID it was
-- registered for: a tenant whose console host is not under its storefront's
-- domain holds credentials for two of them, and a credential answers only the
-- one it was made for. credential_id is unique per tenant rather than across
-- the install, since an authenticator mints it and two tenants are two
-- relying parties to it.
CREATE TABLE user_webauthn_credentials (
    id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    rp_id text NOT NULL,
    credential_id bytea NOT NULL,
    -- The COSE_Key the authenticator returned at registration.
    public_key bytea NOT NULL,
    -- The last signature counter accepted. An authenticator that keeps no
    -- counter reports zero every time, which is accepted while this is zero.
    sign_count bigint DEFAULT 0 NOT NULL,
    aaguid uuid NOT NULL,
    transports text[] DEFAULT '{}'::text[] NOT NULL,
    backup_eligible boolean NOT NULL,
    backed_up boolean NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    CONSTRAINT user_webauthn_credentials_name_check CHECK ((char_length(name) <= 64)),
    CONSTRAINT user_webauthn_credentials_sign_count_check CHECK ((sign_count >= 0))
);

-- CONSTRAINT: user_webauthn_credentials user_webauthn_credentials_pkey
ALTER TABLE ONLY user_webauthn_credentials
    ADD CONSTRAINT user_webauthn_credentials_pkey PRIMARY KEY (id);

-- CONSTRAINT: user_webauthn_credentials user_webauthn_credentials_tenant_public_id_key
ALTER TABLE ONLY user_webauthn_credentials
    ADD CONSTRAINT user_webauthn_credentials_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- CONSTRAINT: user_webauthn_credentials user_webauthn_credentials_tenant_credential_id_key
ALTER TABLE ONLY user_webauthn_credentials
    ADD CONSTRAINT user_webauthn_credentials_tenant_credential_id_key UNIQUE (tenant_id, credential_id);

-- FK CONSTRAINT: user_webauthn_credentials user_webauthn_credentials_tenant_user_id_fkey
ALTER TABLE ONLY user_webauthn_credentials
    ADD CONSTRAINT user_webauthn_credentials_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_user_webauthn_credentials_user_rp_id_created_at
CREATE INDEX idx_user_webauthn_credentials_user_rp_id_created_at ON user_webauthn_credentials USING btree (user_id, rp_id, created_at);

-- ROW SECURITY: user_webauthn_credentials
ALTER TABLE user_webauthn_credentials ENABLE ROW LEVEL SECURITY;

-- POLICY: user_webauthn_credentials user_webauthn_credentials_tenant_isolation
CREATE POLICY user_webauthn_credentials_tenant_isolation ON user_webauthn_credentials USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_webauthn_ceremonies
-- The server's half of a registration or an assertion between its begin and
-- its finish. The challenge is the key: the authenticator signs over it, so
-- the finish finds its row by the challenge the response carries, and deleting
-- that row is what spends it. Nothing of the ceremony is handed to the client
-- to bring back. A row outlives its expiry only until `job
-- purge-mfa-challenges` deletes it.
CREATE TABLE user_webauthn_ceremonies (
    challenge text NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    ceremony text NOT NULL,
    rp_id text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_webauthn_ceremonies_ceremony_check CHECK ((ceremony = ANY (ARRAY['registration'::text, 'authentication'::text])))
);

-- CONSTRAINT: user_webauthn_ceremonies user_webauthn_ceremonies_pkey
ALTER TABLE ONLY user_webauthn_ceremonies
    ADD CONSTRAINT user_webauthn_ceremonies_pkey PRIMARY KEY (challenge);

-- FK CONSTRAINT: user_webauthn_ceremonies user_webauthn_ceremonies_tenant_user_id_fkey
ALTER TABLE ONLY user_webauthn_ceremonies
    ADD CONSTRAINT user_webauthn_ceremonies_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_user_webauthn_ceremonies_user_ceremony
CREATE INDEX idx_user_webauthn_ceremonies_user_ceremony ON user_webauthn_ceremonies USING btree (user_id, ceremony);

-- INDEX: idx_user_webauthn_ceremonies_expires_at
CREATE INDEX idx_user_webauthn_ceremonies_expires_at ON user_webauthn_ceremonies USING btree (expires_at);

-- ROW SECURITY: user_webauthn_ceremonies
ALTER TABLE user_webauthn_ceremonies ENABLE ROW LEVEL SECURITY;

-- POLICY: user_webauthn_ceremonies user_webauthn_ceremonies_tenant_isolation
CREATE POLICY user_webauthn_ceremonies_tenant_isolation ON user_webauthn_ceremonies USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_mfa_lockouts
-- The refused second-factor attempts of an account and the lock they start,
-- moved out of user_mfa_totp so a wrong code and a failed assertion count
-- toward the same limit. An account with no failure since its last success
-- has no row.
CREATE TABLE user_mfa_lockouts (
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_mfa_lockouts user_mfa_lockouts_pkey
ALTER TABLE ONLY user_mfa_lockouts
    ADD CONSTRAINT user_mfa_lockouts_pkey PRIMARY KEY (user_id);

-- FK CONSTRAINT: user_mfa_lockouts user_mfa_lockouts_tenant_user_id_fkey
ALTER TABLE ONLY user_mfa_lockouts
    ADD CONSTRAINT user_mfa_lockouts_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: user_mfa_lockouts
ALTER TABLE user_mfa_lockouts ENABLE ROW LEVEL SECURITY;

-- POLICY: user_mfa_lockouts user_mfa_lockouts_tenant_isolation
CREATE POLICY user_mfa_lockouts_tenant_isolation ON user_mfa_lockouts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

INSERT INTO user_mfa_lockouts (user_id, tenant_id, failed_attempts, locked_until)
SELECT user_id, tenant_id, failed_attempts, locked_until
FROM user_mfa_totp
WHERE failed_attempts > 0
    OR locked_until IS NOT NULL;

ALTER TABLE user_mfa_totp
    DROP COLUMN failed_attempts,
    DROP COLUMN locked_until;
