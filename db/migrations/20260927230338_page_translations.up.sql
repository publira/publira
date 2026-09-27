-- TABLE: page_translations
-- One locale's rendering of a page: its title, and the version of its own
-- history that is live. The page itself keeps what every locale shares.
CREATE TABLE page_translations (
    id uuid NOT NULL,
    page_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    title text NOT NULL,
    published_version_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT page_translations_locale_not_blank_check CHECK ((btrim(locale) <> ''))
);

-- CONSTRAINT: page_translations page_translations_pkey
ALTER TABLE ONLY page_translations
    ADD CONSTRAINT page_translations_pkey PRIMARY KEY (id);

-- CONSTRAINT: page_translations page_translations_page_id_locale_key
ALTER TABLE ONLY page_translations
    ADD CONSTRAINT page_translations_page_id_locale_key UNIQUE (page_id, locale);

-- CONSTRAINT: page_translations page_translations_tenant_id_page_id_id_key
-- The target of the reference that ties a version to both its page and its
-- translation.
ALTER TABLE ONLY page_translations
    ADD CONSTRAINT page_translations_tenant_id_page_id_id_key UNIQUE (tenant_id, page_id, id);

-- FK CONSTRAINT: page_translations page_translations_tenant_id_fkey
ALTER TABLE ONLY page_translations
    ADD CONSTRAINT page_translations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: page_translations page_translations_tenant_page_id_fkey
ALTER TABLE ONLY page_translations
    ADD CONSTRAINT page_translations_tenant_page_id_fkey FOREIGN KEY (tenant_id, page_id) REFERENCES pages(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: page_translations
ALTER TABLE page_translations ENABLE ROW LEVEL SECURITY;

-- POLICY: page_translations page_translations_tenant_isolation
CREATE POLICY page_translations_tenant_isolation ON page_translations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- Every existing page becomes one translation in its tenant's default locale,
-- carrying the title and the live version the page held until now.
INSERT INTO page_translations (id, page_id, tenant_id, locale, title, published_version_id, created_at, updated_at)
SELECT uuidv7(), p.id, p.tenant_id, t.default_locale, p.title, p.published_version_id, p.created_at, p.updated_at
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id;

-- COLUMN: page_versions translation_id
-- Added empty and filled before it is required, since every existing version
-- belongs to the one translation its page has just been given.
ALTER TABLE ONLY page_versions
    ADD COLUMN translation_id uuid;

UPDATE page_versions pv
SET translation_id = pt.id
FROM page_translations pt
WHERE pt.page_id = pv.page_id;

ALTER TABLE ONLY page_versions
    ALTER COLUMN translation_id SET NOT NULL;

-- CONSTRAINT: page_versions page_versions_translation_id_version_number_key
-- Each translation numbers its own history from 1.
ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_page_id_version_number_key;

ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_translation_id_version_number_key UNIQUE (translation_id, version_number);

-- CONSTRAINT: page_versions page_versions_tenant_id_translation_id_id_key
-- The target of the reference that keeps a translation's live version inside
-- its own history.
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_tenant_id_translation_id_id_key UNIQUE (tenant_id, translation_id, id);

-- FK CONSTRAINT: page_versions page_versions_tenant_page_translation_id_fkey
-- Carries page_id so a version cannot name a translation of another page.
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_tenant_page_translation_id_fkey FOREIGN KEY (tenant_id, page_id, translation_id) REFERENCES page_translations(tenant_id, page_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: page_translations page_translations_tenant_published_version_id_fkey
ALTER TABLE ONLY page_translations
    ADD CONSTRAINT page_translations_tenant_published_version_id_fkey FOREIGN KEY (tenant_id, id, published_version_id) REFERENCES page_versions(tenant_id, translation_id, id) ON DELETE SET NULL (published_version_id);

-- INDEX: idx_page_translations_published_version_id
CREATE INDEX idx_page_translations_published_version_id ON page_translations USING btree (published_version_id);

-- FUNCTION: page_translation_for
-- The translation of a page to show for a locale: that locale's, else the
-- tenant default locale's, else the page's oldest, so a page stays reachable
-- after its tenant changes default locale.
--
-- SECURITY INVOKER keeps page_translations behind the caller's own row-level
-- security, as reader_may_open_episode does.
CREATE FUNCTION page_translation_for(page_id uuid, locale text) RETURNS uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT pt.id
    FROM page_translations pt
        JOIN tenants t ON t.id = pt.tenant_id
    WHERE pt.page_id = page_translation_for.page_id
    ORDER BY (pt.locale = page_translation_for.locale) DESC,
        (pt.locale = t.default_locale) DESC,
        pt.created_at,
        pt.id
    LIMIT 1
$$;
