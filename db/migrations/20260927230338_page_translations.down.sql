DROP FUNCTION page_translation_for(uuid, text);

ALTER TABLE ONLY page_translations
    DROP CONSTRAINT page_translations_tenant_published_version_id_fkey;

ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_tenant_page_translation_id_fkey,
    DROP CONSTRAINT page_versions_tenant_id_translation_id_id_key,
    DROP CONSTRAINT page_versions_translation_id_version_number_key;

-- Fails rather than dropping a version when two translations of one page have
-- numbered a version alike.
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_page_id_version_number_key UNIQUE (page_id, version_number);

ALTER TABLE ONLY page_versions
    DROP COLUMN translation_id;

DROP TABLE page_translations;
