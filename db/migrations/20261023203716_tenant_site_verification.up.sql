-- TABLE: tenant_site_verification
-- The codes a search engine gives a tenant to prove it owns its storefront,
-- which the storefront writes into every page as a <meta> tag. Each one is the
-- tag's content value alone, never the element; the server trims and checks
-- it before storing it, and the checks keep out anything that could close the
-- attribute it is written into. A tenant without a row, and a NULL column, has
-- no code. The codes appear in every page's HTML, so neither is secret.
CREATE TABLE tenant_site_verification (
    tenant_id uuid NOT NULL,
    -- Google Search Console's google-site-verification code.
    google_site_verification text,
    -- Bing Webmaster Tools' msvalidate.01 code.
    bing_site_verification text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_site_verification_google_check CHECK (google_site_verification ~ '^[A-Za-z0-9_-]{1,128}$'),
    CONSTRAINT tenant_site_verification_bing_check CHECK (bing_site_verification ~ '^[A-Za-z0-9_-]{1,128}$')
);

-- CONSTRAINT: tenant_site_verification tenant_site_verification_pkey
ALTER TABLE ONLY tenant_site_verification
    ADD CONSTRAINT tenant_site_verification_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_site_verification tenant_site_verification_tenant_id_fkey
ALTER TABLE ONLY tenant_site_verification
    ADD CONSTRAINT tenant_site_verification_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_site_verification
ALTER TABLE tenant_site_verification ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_site_verification tenant_site_verification_tenant_isolation
CREATE POLICY tenant_site_verification_tenant_isolation ON tenant_site_verification USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
