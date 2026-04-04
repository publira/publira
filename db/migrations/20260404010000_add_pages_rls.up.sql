-- Add RLS to pages and page_versions introduced in 20260403040000.
-- page_versions gets a tenant_id column (backfilled from pages) following the
-- same pattern used for episodes, series_listings, etc. in 20260401000000.

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY pages_tenant_isolation ON pages
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

ALTER TABLE page_versions ADD COLUMN tenant_id UUID;
UPDATE page_versions SET tenant_id = p.tenant_id FROM pages p WHERE p.id = page_versions.page_id;
ALTER TABLE page_versions ALTER COLUMN tenant_id SET NOT NULL;
ALTER TABLE page_versions ADD CONSTRAINT fk_page_versions_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
CREATE INDEX idx_page_versions_tenant_id ON page_versions (tenant_id);

ALTER TABLE page_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY page_versions_tenant_isolation ON page_versions
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
