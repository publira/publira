-- TABLE: tenant_crawler_settings
-- The crawlers and paths a tenant's robots.txt excludes. The user agents are
-- tokens from the list the server knows, and the paths are what the tenant
-- typed, normalized; the server validates both before storing them. A tenant
-- without a row excludes nothing.
CREATE TABLE tenant_crawler_settings (
    tenant_id uuid NOT NULL,
    excluded_user_agents text[] DEFAULT '{}'::text[] NOT NULL,
    excluded_paths text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: tenant_crawler_settings tenant_crawler_settings_pkey
ALTER TABLE ONLY tenant_crawler_settings
    ADD CONSTRAINT tenant_crawler_settings_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_crawler_settings tenant_crawler_settings_tenant_id_fkey
ALTER TABLE ONLY tenant_crawler_settings
    ADD CONSTRAINT tenant_crawler_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_crawler_settings
ALTER TABLE tenant_crawler_settings ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_crawler_settings tenant_crawler_settings_tenant_isolation
CREATE POLICY tenant_crawler_settings_tenant_isolation ON tenant_crawler_settings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
