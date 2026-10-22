-- TABLE: tenant_sign_up_settings
-- Whether a tenant accepts new reader accounts, and the message its storefront
-- shows in place of the sign-up form while it does not. The message is plain
-- text the server has trimmed; empty means the storefront's own default copy.
-- A tenant without a row accepts sign-ups.
CREATE TABLE tenant_sign_up_settings (
    tenant_id uuid NOT NULL,
    sign_up_open boolean DEFAULT true NOT NULL,
    closed_message text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_sign_up_settings_closed_message_check CHECK (((closed_message = btrim(closed_message)) AND (char_length(closed_message) <= 1000)))
);

-- CONSTRAINT: tenant_sign_up_settings tenant_sign_up_settings_pkey
ALTER TABLE ONLY tenant_sign_up_settings
    ADD CONSTRAINT tenant_sign_up_settings_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_sign_up_settings tenant_sign_up_settings_tenant_id_fkey
ALTER TABLE ONLY tenant_sign_up_settings
    ADD CONSTRAINT tenant_sign_up_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_sign_up_settings
ALTER TABLE tenant_sign_up_settings ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_sign_up_settings tenant_sign_up_settings_tenant_isolation
CREATE POLICY tenant_sign_up_settings_tenant_isolation ON tenant_sign_up_settings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
