-- TABLE: tenant_config_translations
-- One locale's copy of a tenant's site: its tagline, its description, and its
-- copyright line. A field the locale has no copy for is empty, and a locale
-- with no copy at all has no row, so a reader in it is served another
-- locale's.
CREATE TABLE tenant_config_translations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    site_tagline text DEFAULT '' NOT NULL,
    site_description text DEFAULT '' NOT NULL,
    copyright_text text DEFAULT '' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_config_translations_locale_not_blank_check CHECK ((btrim(locale) <> '')),
    CONSTRAINT tenant_config_translations_copy_not_blank_check CHECK (((btrim(site_tagline) <> '') OR (btrim(site_description) <> '') OR (btrim(copyright_text) <> '')))
);

-- CONSTRAINT: tenant_config_translations tenant_config_translations_pkey
ALTER TABLE ONLY tenant_config_translations
    ADD CONSTRAINT tenant_config_translations_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_config_translations tenant_config_translations_tenant_id_locale_key
ALTER TABLE ONLY tenant_config_translations
    ADD CONSTRAINT tenant_config_translations_tenant_id_locale_key UNIQUE (tenant_id, locale);

-- FK CONSTRAINT: tenant_config_translations tenant_config_translations_tenant_id_fkey
ALTER TABLE ONLY tenant_config_translations
    ADD CONSTRAINT tenant_config_translations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_config_translations
ALTER TABLE tenant_config_translations ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_config_translations tenant_config_translations_tenant_isolation
CREATE POLICY tenant_config_translations_tenant_isolation ON tenant_config_translations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- Every tenant's existing copy becomes one translation in its default locale.
-- A tenant that wrote none gets no row.
INSERT INTO tenant_config_translations (id, tenant_id, locale, site_tagline, site_description, copyright_text, created_at, updated_at)
SELECT uuidv7(),
    tc.tenant_id,
    t.default_locale,
    COALESCE(tc.site_tagline, ''),
    COALESCE(tc.site_description, ''),
    COALESCE(tc.copyright_text, ''),
    tc.created_at,
    tc.updated_at
FROM tenant_config tc
    JOIN tenants t ON t.id = tc.tenant_id
WHERE btrim(COALESCE(tc.site_tagline, '')) <> ''
    OR btrim(COALESCE(tc.site_description, '')) <> ''
    OR btrim(COALESCE(tc.copyright_text, '')) <> '';

-- FUNCTION: tenant_config_translation_for
-- The copy of a tenant's site to show for a locale: that locale's, else the
-- tenant default locale's, else the oldest, as page_translation_for picks a
-- page's. An empty locale asks for the tenant default locale's. No row when
-- the tenant has written no copy in any locale.
--
-- SECURITY INVOKER keeps tenant_config_translations behind the caller's own
-- row-level security, as page_translation_for does.
CREATE FUNCTION tenant_config_translation_for(tenant_id uuid, locale text) RETURNS SETOF tenant_config_translations
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT tct.*
    FROM tenant_config_translations tct
        JOIN tenants t ON t.id = tct.tenant_id
    WHERE tct.tenant_id = tenant_config_translation_for.tenant_id
    ORDER BY (tct.locale = tenant_config_translation_for.locale) DESC,
        (tct.locale = t.default_locale) DESC,
        tct.created_at,
        tct.id
    LIMIT 1
$$;
