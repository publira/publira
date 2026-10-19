-- TABLE: announcement_translations
-- One locale's copy of an announcement: its title and its body. The
-- announcement itself keeps what every locale shares.
CREATE TABLE announcement_translations (
    id uuid NOT NULL,
    announcement_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT announcement_translations_locale_not_blank_check CHECK ((btrim(locale) <> ''))
);

-- CONSTRAINT: announcement_translations announcement_translations_pkey
ALTER TABLE ONLY announcement_translations
    ADD CONSTRAINT announcement_translations_pkey PRIMARY KEY (id);

-- CONSTRAINT: announcement_translations announcement_translations_announcement_id_locale_key
ALTER TABLE ONLY announcement_translations
    ADD CONSTRAINT announcement_translations_announcement_id_locale_key UNIQUE (announcement_id, locale);

-- FK CONSTRAINT: announcement_translations announcement_translations_tenant_id_fkey
ALTER TABLE ONLY announcement_translations
    ADD CONSTRAINT announcement_translations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcement_translations announcement_translations_tenant_announcement_id_fkey
ALTER TABLE ONLY announcement_translations
    ADD CONSTRAINT announcement_translations_tenant_announcement_id_fkey FOREIGN KEY (tenant_id, announcement_id) REFERENCES announcements(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: announcement_translations
ALTER TABLE announcement_translations ENABLE ROW LEVEL SECURITY;

-- POLICY: announcement_translations announcement_translations_tenant_isolation
CREATE POLICY announcement_translations_tenant_isolation ON announcement_translations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- Every existing announcement becomes one translation in its tenant's default
-- locale, carrying the title and the body it held until now.
INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body, created_at, updated_at)
SELECT uuidv7(), a.id, a.tenant_id, t.default_locale, a.title, a.body, a.created_at, a.created_at
FROM announcements a
    JOIN tenants t ON t.id = a.tenant_id;

-- FUNCTION: announcement_translation_for
-- The translation of an announcement to show for a locale: that locale's,
-- else the tenant default locale's, else the announcement's oldest, as
-- page_translation_for picks a page's. An empty locale asks for the tenant
-- default locale's.
--
-- It answers the row itself, and a read joins it with CROSS JOIN LATERAL, as
-- series_translation_for is joined.
--
-- SECURITY INVOKER keeps announcement_translations behind the caller's own
-- row-level security, as page_translation_for does.
CREATE FUNCTION announcement_translation_for(announcement_id uuid, locale text) RETURNS SETOF announcement_translations
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT at.*
    FROM announcement_translations at
        JOIN tenants t ON t.id = at.tenant_id
    WHERE at.announcement_id = announcement_translation_for.announcement_id
    ORDER BY (at.locale = announcement_translation_for.locale) DESC,
        (at.locale = t.default_locale) DESC,
        at.created_at,
        at.id
    LIMIT 1
$$;

-- COLUMN: users last_locale
-- The locale the reader's latest signed-in request to the public API named:
-- the storefront's URL, or the app's resolved language. A notification is
-- rendered for its reader in it, and in the tenant default locale while it is
-- NULL.
ALTER TABLE ONLY users
    ADD COLUMN last_locale text;

ALTER TABLE ONLY users
    ADD CONSTRAINT users_last_locale_not_blank_check CHECK ((btrim(last_locale) <> ''));
