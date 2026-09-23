-- What the server needs to talk to the App Store and Google Play on a tenant's
-- behalf, and whether the tenant's app sells through the store at all.
--
-- The identity of the app each store sells in is not repeated here: it is the
-- tenant_config.ios_bundle_identifier and android_application_id the app
-- association already names.
--
-- The CHECK constraint on tenant_config is added NOT VALID so this file takes
-- its ACCESS EXCLUSIVE lock without scanning the table; the next migration
-- validates it under a lock that lets reads and writes continue.

-- TABLE: tenant_app_store_config
-- The App Store Connect API key the server signs its App Store Server API
-- requests with. The issuer ID and the key ID are not secret and are stored as
-- they are; the .p8 private key is stored only as a secretcrypto envelope, next
-- to a masked hint so a read never decrypts.
CREATE TABLE tenant_app_store_config (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    issuer_id text,
    key_id text,
    private_key_encrypted text,
    private_key_hint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_app_store_config_issuer_id_check CHECK (((issuer_id IS NULL) OR (issuer_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text))),
    CONSTRAINT tenant_app_store_config_key_id_check CHECK (((key_id IS NULL) OR (key_id ~ '^[A-Z0-9]{10}$'::text))),
    CONSTRAINT tenant_app_store_config_private_key_encrypted_envelope_check CHECK (((private_key_encrypted IS NULL) OR (private_key_encrypted LIKE 'enc:%'::text))),
    CONSTRAINT tenant_app_store_config_enabled_requires_key CHECK (((NOT enabled) OR ((issuer_id IS NOT NULL) AND (key_id IS NOT NULL) AND (private_key_encrypted IS NOT NULL) AND (btrim(private_key_encrypted) <> ''::text))))
);

-- CONSTRAINT: tenant_app_store_config tenant_app_store_config_pkey
ALTER TABLE ONLY tenant_app_store_config
    ADD CONSTRAINT tenant_app_store_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_app_store_config tenant_app_store_config_tenant_id_fkey
ALTER TABLE ONLY tenant_app_store_config
    ADD CONSTRAINT tenant_app_store_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_app_store_config
ALTER TABLE tenant_app_store_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_app_store_config tenant_app_store_config_tenant_isolation
CREATE POLICY tenant_app_store_config_tenant_isolation ON tenant_app_store_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_google_play_config
-- The service account the server calls the Google Play Developer API as. The
-- JSON key is stored only as a secretcrypto envelope; the account's email
-- address, which the tenant grants access to in the Play Console, is not
-- secret and is kept beside it for display.
CREATE TABLE tenant_google_play_config (
    tenant_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    service_account_email text,
    service_account_key_encrypted text,
    service_account_key_hint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_google_play_config_service_account_key_encrypted_envelope_check CHECK (((service_account_key_encrypted IS NULL) OR (service_account_key_encrypted LIKE 'enc:%'::text))),
    CONSTRAINT tenant_google_play_config_service_account_email_check CHECK (((service_account_email IS NULL) = (service_account_key_encrypted IS NULL))),
    CONSTRAINT tenant_google_play_config_enabled_requires_key CHECK (((NOT enabled) OR ((service_account_key_encrypted IS NOT NULL) AND (btrim(service_account_key_encrypted) <> ''::text))))
);

-- CONSTRAINT: tenant_google_play_config tenant_google_play_config_pkey
ALTER TABLE ONLY tenant_google_play_config
    ADD CONSTRAINT tenant_google_play_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_google_play_config tenant_google_play_config_tenant_id_fkey
ALTER TABLE ONLY tenant_google_play_config
    ADD CONSTRAINT tenant_google_play_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_google_play_config
ALTER TABLE tenant_google_play_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_google_play_config tenant_google_play_config_tenant_isolation
CREATE POLICY tenant_google_play_config_tenant_isolation ON tenant_google_play_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: tenant_config app_purchase_route
-- How the app sells an episode it may sell: 'external_checkout', the web
-- checkout every tenant uses today and so the default, or 'store', the store's
-- own in-app purchase. That 'store' needs an enabled store is enforced where
-- both are written, since the two live in different tables.
ALTER TABLE ONLY tenant_config
    ADD COLUMN app_purchase_route text DEFAULT 'external_checkout'::text NOT NULL,
    ADD CONSTRAINT tenant_config_app_purchase_route_check CHECK ((app_purchase_route = ANY (ARRAY['external_checkout'::text, 'store'::text]))) NOT VALID;
