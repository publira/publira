-- Sign in with Apple and Google: what a tenant configures for each provider,
-- the provider accounts linked to a reader, and the nonces already spent.

-- COLUMN: users password_hash
-- A reader who signed up through a provider has no password until they set
-- one through the password reset flow.
ALTER TABLE ONLY users
    ALTER COLUMN password_hash DROP NOT NULL;

-- TABLE: tenant_apple_sign_in_config
-- The Services ID the storefront signs in with, and the Sign in with Apple key
-- the server signs its client secret with to exchange an authorization code
-- and to revoke the tokens it got. The iOS app signs in with the bundle
-- identifier of tenant_config, which is not repeated here. The key is stored
-- only as a secretcrypto envelope, next to a masked hint so a read never
-- decrypts.
CREATE TABLE tenant_apple_sign_in_config (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    services_id text,
    team_id text,
    key_id text,
    private_key_encrypted text,
    private_key_hint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_apple_sign_in_config_services_id_check CHECK (((services_id IS NULL) OR (services_id ~ '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$'::text))),
    CONSTRAINT tenant_apple_sign_in_config_team_id_check CHECK (((team_id IS NULL) OR (team_id ~ '^[A-Z0-9]{10}$'::text))),
    CONSTRAINT tenant_apple_sign_in_config_key_id_check CHECK (((key_id IS NULL) OR (key_id ~ '^[A-Z0-9]{10}$'::text))),
    CONSTRAINT tenant_apple_sign_in_config_private_key_encrypted_envelope_check CHECK (((private_key_encrypted IS NULL) OR (private_key_encrypted LIKE 'enc:%'::text))),
    CONSTRAINT tenant_apple_sign_in_config_enabled_requires_key CHECK (((NOT enabled) OR ((team_id IS NOT NULL) AND (key_id IS NOT NULL) AND (private_key_encrypted IS NOT NULL))))
);

-- CONSTRAINT: tenant_apple_sign_in_config tenant_apple_sign_in_config_pkey
ALTER TABLE ONLY tenant_apple_sign_in_config
    ADD CONSTRAINT tenant_apple_sign_in_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_apple_sign_in_config tenant_apple_sign_in_config_tenant_id_fkey
ALTER TABLE ONLY tenant_apple_sign_in_config
    ADD CONSTRAINT tenant_apple_sign_in_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_apple_sign_in_config
ALTER TABLE tenant_apple_sign_in_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_apple_sign_in_config tenant_apple_sign_in_config_tenant_isolation
CREATE POLICY tenant_apple_sign_in_config_tenant_isolation ON tenant_apple_sign_in_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_google_sign_in_config
-- The OAuth client IDs whose ID tokens the tenant accepts: the web client,
-- which the storefront and the Android app sign in with, and the iOS client.
-- Verifying a token needs no secret, so none is stored.
CREATE TABLE tenant_google_sign_in_config (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    web_client_id text,
    ios_client_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_google_sign_in_config_web_client_id_check CHECK (((web_client_id IS NULL) OR (web_client_id ~ '^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$'::text))),
    CONSTRAINT tenant_google_sign_in_config_ios_client_id_check CHECK (((ios_client_id IS NULL) OR (ios_client_id ~ '^[0-9]+-[0-9a-z]+\.apps\.googleusercontent\.com$'::text))),
    CONSTRAINT tenant_google_sign_in_config_enabled_requires_client CHECK (((NOT enabled) OR (web_client_id IS NOT NULL) OR (ios_client_id IS NOT NULL)))
);

-- CONSTRAINT: tenant_google_sign_in_config tenant_google_sign_in_config_pkey
ALTER TABLE ONLY tenant_google_sign_in_config
    ADD CONSTRAINT tenant_google_sign_in_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_google_sign_in_config tenant_google_sign_in_config_tenant_id_fkey
ALTER TABLE ONLY tenant_google_sign_in_config
    ADD CONSTRAINT tenant_google_sign_in_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_google_sign_in_config
ALTER TABLE tenant_google_sign_in_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_google_sign_in_config tenant_google_sign_in_config_tenant_isolation
CREATE POLICY tenant_google_sign_in_config_tenant_isolation ON tenant_google_sign_in_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_identities
-- A provider account linked to a reader. subject is the provider's stable id
-- for the account; email_at_link is the address its token carried when it was
-- linked, kept for the reader to recognize the link by. The refresh token is
-- Apple's, stored as a secretcrypto envelope with the client it was issued to,
-- so the account's tokens can be revoked when the link or the account goes.
CREATE TABLE user_identities (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    subject text NOT NULL,
    email_at_link text NOT NULL,
    refresh_token_encrypted text,
    refresh_token_client_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_identities_provider_check CHECK ((provider = ANY (ARRAY['apple'::text, 'google'::text]))),
    CONSTRAINT user_identities_subject_check CHECK ((btrim(subject) <> ''::text)),
    CONSTRAINT user_identities_refresh_token_encrypted_envelope_check CHECK (((refresh_token_encrypted IS NULL) OR (refresh_token_encrypted LIKE 'enc:%'::text))),
    CONSTRAINT user_identities_refresh_token_client_id_check CHECK (((refresh_token_encrypted IS NULL) = (refresh_token_client_id IS NULL)))
);

-- CONSTRAINT: user_identities user_identities_pkey
ALTER TABLE ONLY user_identities
    ADD CONSTRAINT user_identities_pkey PRIMARY KEY (id);

-- CONSTRAINT: user_identities user_identities_tenant_provider_subject_key
-- One provider account signs in to one reader of a tenant.
ALTER TABLE ONLY user_identities
    ADD CONSTRAINT user_identities_tenant_provider_subject_key UNIQUE (tenant_id, provider, subject);

-- CONSTRAINT: user_identities user_identities_tenant_user_provider_key
-- A reader links one account per provider, which is what unlinking names.
ALTER TABLE ONLY user_identities
    ADD CONSTRAINT user_identities_tenant_user_provider_key UNIQUE (tenant_id, user_id, provider);

-- FK CONSTRAINT: user_identities user_identities_tenant_id_fkey
ALTER TABLE ONLY user_identities
    ADD CONSTRAINT user_identities_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_identities user_identities_tenant_user_id_fkey
ALTER TABLE ONLY user_identities
    ADD CONSTRAINT user_identities_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: user_identities
ALTER TABLE user_identities ENABLE ROW LEVEL SECURITY;

-- POLICY: user_identities user_identities_tenant_isolation
CREATE POLICY user_identities_tenant_isolation ON user_identities USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: sign_in_nonces
-- The nonces of the ID tokens a sign-in has accepted, by SHA-256, until the
-- token they were spent on expires. A second sign-in with the same nonce is a
-- replay. The insert that spends one also drops the tenant's expired rows.
CREATE TABLE sign_in_nonces (
    tenant_id uuid NOT NULL,
    nonce_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL
);

-- CONSTRAINT: sign_in_nonces sign_in_nonces_pkey
ALTER TABLE ONLY sign_in_nonces
    ADD CONSTRAINT sign_in_nonces_pkey PRIMARY KEY (tenant_id, nonce_hash);

-- FK CONSTRAINT: sign_in_nonces sign_in_nonces_tenant_id_fkey
ALTER TABLE ONLY sign_in_nonces
    ADD CONSTRAINT sign_in_nonces_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_sign_in_nonces_tenant_expires_at
CREATE INDEX idx_sign_in_nonces_tenant_expires_at ON sign_in_nonces USING btree (tenant_id, expires_at);

-- ROW SECURITY: sign_in_nonces
ALTER TABLE sign_in_nonces ENABLE ROW LEVEL SECURITY;

-- POLICY: sign_in_nonces sign_in_nonces_tenant_isolation
CREATE POLICY sign_in_nonces_tenant_isolation ON sign_in_nonces USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
