-- TABLE: tenant_inbound_email_config
-- A tenant's inbound email provider: the service that receives mail on the
-- tenant's inbound domain and posts it to the storefront's webhook, which is
-- how a reader's emailed reply to a contact message answer reaches the
-- console. Which credential fields a provider has, and which are required, is
-- the provider's declaration in the server, as it is for tenant_payment_config.
CREATE TABLE tenant_inbound_email_config (
    tenant_id uuid NOT NULL,
    provider character varying(32) NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    -- The domain whose mail the tenant routes to the provider. An answer's
    -- Reply-To is an address on it once the settings are ready, so it is
    -- stored in lower case, the form an address on it is compared in. 233 is
    -- what is left of a 254-byte mailbox once "contact+", a 12-character
    -- public id, and "@" come before it.
    domain character varying(233),
    -- Field name to a secretcrypto envelope of its value, one envelope per
    -- field so a single field can be replaced or cleared without the others.
    credentials_encrypted jsonb DEFAULT '{}'::jsonb NOT NULL,
    -- Field name to what the console shows for a stored field without
    -- decrypting it.
    credential_hints jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_inbound_email_config_domain_check CHECK (((domain IS NULL) OR ((length((domain)::text) > 0) AND ((domain)::text = lower((domain)::text))))),
    -- Mail cannot be matched to a per-message address on no domain.
    CONSTRAINT tenant_inbound_email_config_enabled_requires_domain CHECK (((NOT enabled) OR (domain IS NOT NULL))),
    CONSTRAINT tenant_inbound_email_config_credentials_encrypted_envelope_check CHECK (((jsonb_typeof(credentials_encrypted) = 'object'::text) AND (NOT jsonb_path_exists(credentials_encrypted, '$.* ? (@.type() != "string" || !(@ starts with "enc:"))'::jsonpath)))),
    CONSTRAINT tenant_inbound_email_config_credential_hints_object_check CHECK ((jsonb_typeof(credential_hints) = 'object'::text))
);

-- CONSTRAINT: tenant_inbound_email_config tenant_inbound_email_config_pkey
ALTER TABLE ONLY tenant_inbound_email_config
    ADD CONSTRAINT tenant_inbound_email_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_inbound_email_config tenant_inbound_email_config_tenant_id_fkey
ALTER TABLE ONLY tenant_inbound_email_config
    ADD CONSTRAINT tenant_inbound_email_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_inbound_email_config
ALTER TABLE tenant_inbound_email_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_inbound_email_config tenant_inbound_email_config_tenant_isolation
CREATE POLICY tenant_inbound_email_config_tenant_isolation ON tenant_inbound_email_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
