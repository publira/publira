ALTER TABLE ONLY pages
    ADD COLUMN title text,
    ADD COLUMN published_version_id uuid;

-- A page takes back its default-locale translation, or its oldest one when the
-- tenant has since changed its default locale.
UPDATE pages p
SET title = chosen.title,
    published_version_id = chosen.published_version_id
FROM (
        SELECT DISTINCT ON (pt.page_id) pt.page_id, pt.title, pt.published_version_id
        FROM page_translations pt
            JOIN tenants t ON t.id = pt.tenant_id
        ORDER BY pt.page_id, (pt.locale = t.default_locale) DESC, pt.created_at, pt.id
    ) chosen
WHERE chosen.page_id = p.id;

ALTER TABLE ONLY pages
    ALTER COLUMN title SET NOT NULL;

ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_tenant_published_version_id_fkey FOREIGN KEY (tenant_id, published_version_id) REFERENCES page_versions(tenant_id, id) ON DELETE SET NULL (published_version_id);

CREATE INDEX idx_pages_published_version_id ON pages USING btree (published_version_id);
