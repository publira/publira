DROP INDEX IF EXISTS idx_page_versions_tenant_id;
ALTER TABLE page_versions DROP CONSTRAINT IF EXISTS fk_page_versions_tenant_id;
ALTER TABLE page_versions DROP COLUMN IF EXISTS tenant_id;
DROP POLICY IF EXISTS page_versions_tenant_isolation ON page_versions;
ALTER TABLE page_versions DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pages_tenant_isolation ON pages;
ALTER TABLE pages DISABLE ROW LEVEL SECURITY;
