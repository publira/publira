-- COLUMN: pages title, published_version_id
-- Both belong to a page's translations now. Dropping published_version_id
-- takes pages_tenant_published_version_id_fkey and
-- idx_pages_published_version_id with it.
ALTER TABLE ONLY pages
    DROP COLUMN title,
    DROP COLUMN published_version_id;
