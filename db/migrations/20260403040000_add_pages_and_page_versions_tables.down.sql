DROP INDEX IF EXISTS idx_page_versions_status_publish_at;
DROP INDEX IF EXISTS idx_page_versions_page_id_created_at;
DROP INDEX IF EXISTS idx_pages_published_version_id;
DROP INDEX IF EXISTS idx_pages_tenant_id;

ALTER TABLE pages
    DROP CONSTRAINT IF EXISTS pages_published_version_id_fkey;

DROP TABLE IF EXISTS page_versions;
DROP TABLE IF EXISTS pages;
