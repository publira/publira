-- The Firebase project a tenant's mobile app is built with, and the service
-- account the worker sends that app's push notifications as. A tenant without a
-- row has mobile push disabled; the row is written whole and deleted whole, so
-- one that exists is always a complete credential.
CREATE TABLE tenant_fcm_config (
    tenant_id uuid NOT NULL,
    project_id text NOT NULL,
    -- The service account's address, kept apart from the sealed key so the
    -- console can say which account is connected without decrypting anything.
    client_email text NOT NULL,
    -- The service account key JSON, sealed with the secret encryption keys.
    service_account_json_encrypted text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_fcm_config_project_id_not_blank_check CHECK ((btrim(project_id) <> '')),
    CONSTRAINT tenant_fcm_config_client_email_not_blank_check CHECK ((btrim(client_email) <> '')),
    CONSTRAINT tenant_fcm_config_service_account_json_envelope_check CHECK ((service_account_json_encrypted LIKE 'enc:%'::text))
);

-- CONSTRAINT: tenant_fcm_config tenant_fcm_config_pkey
ALTER TABLE ONLY tenant_fcm_config
    ADD CONSTRAINT tenant_fcm_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_fcm_config tenant_fcm_config_tenant_id_fkey
ALTER TABLE ONLY tenant_fcm_config
    ADD CONSTRAINT tenant_fcm_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_fcm_config
ALTER TABLE tenant_fcm_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_fcm_config tenant_fcm_config_tenant_isolation
CREATE POLICY tenant_fcm_config_tenant_isolation ON tenant_fcm_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
