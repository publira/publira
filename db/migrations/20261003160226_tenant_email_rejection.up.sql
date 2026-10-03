-- The email addresses a tenant refuses at reader sign-up and at a reader's
-- email change: whether the platform's disposable-domain list applies, and the
-- addresses and domains the tenant lists itself.

-- TABLE: tenant_email_rejection_settings
-- Whether the disposable-domain list the platform policy names applies to the
-- tenant. A tenant without a row has it off.
CREATE TABLE tenant_email_rejection_settings (
    tenant_id uuid NOT NULL,
    reject_disposable_domains boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: tenant_email_rejection_settings tenant_email_rejection_settings_pkey
ALTER TABLE ONLY tenant_email_rejection_settings
    ADD CONSTRAINT tenant_email_rejection_settings_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_email_rejection_settings tenant_email_rejection_settings_tenant_id_fkey
ALTER TABLE ONLY tenant_email_rejection_settings
    ADD CONSTRAINT tenant_email_rejection_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_email_rejection_settings
ALTER TABLE tenant_email_rejection_settings ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_email_rejection_settings tenant_email_rejection_settings_tenant_isolation
CREATE POLICY tenant_email_rejection_settings_tenant_isolation ON tenant_email_rejection_settings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_email_rejection_entries
-- One address or domain the tenant refuses, lowercased. An entry with an @ is
-- an address and any other is a domain, which also refuses its subdomains.
-- The server validates an entry before storing it; the check only keeps a
-- value no comparison could match out.
CREATE TABLE tenant_email_rejection_entries (
    tenant_id uuid NOT NULL,
    entry text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_email_rejection_entries_entry_check CHECK (((entry <> ''::text) AND (entry = lower(entry)) AND (entry = btrim(entry)) AND (char_length(entry) <= 254)))
);

-- CONSTRAINT: tenant_email_rejection_entries tenant_email_rejection_entries_pkey
ALTER TABLE ONLY tenant_email_rejection_entries
    ADD CONSTRAINT tenant_email_rejection_entries_pkey PRIMARY KEY (tenant_id, entry);

-- FK CONSTRAINT: tenant_email_rejection_entries tenant_email_rejection_entries_tenant_id_fkey
ALTER TABLE ONLY tenant_email_rejection_entries
    ADD CONSTRAINT tenant_email_rejection_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_email_rejection_entries
ALTER TABLE tenant_email_rejection_entries ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_email_rejection_entries tenant_email_rejection_entries_tenant_isolation
CREATE POLICY tenant_email_rejection_entries_tenant_isolation ON tenant_email_rejection_entries USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
