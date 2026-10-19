-- TABLE: genre_translations
-- One locale's name of a genre. The genre itself keeps what every locale
-- shares: its public ID, its slug, its place in the list, and its eye-catch.
CREATE TABLE genre_translations (
    id uuid NOT NULL,
    genre_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT genre_translations_locale_not_blank_check CHECK ((btrim(locale) <> ''))
);

-- CONSTRAINT: genre_translations genre_translations_pkey
ALTER TABLE ONLY genre_translations
    ADD CONSTRAINT genre_translations_pkey PRIMARY KEY (id);

-- CONSTRAINT: genre_translations genre_translations_genre_id_locale_key
ALTER TABLE ONLY genre_translations
    ADD CONSTRAINT genre_translations_genre_id_locale_key UNIQUE (genre_id, locale);

-- FK CONSTRAINT: genre_translations genre_translations_tenant_id_fkey
ALTER TABLE ONLY genre_translations
    ADD CONSTRAINT genre_translations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: genre_translations genre_translations_tenant_genre_id_fkey
ALTER TABLE ONLY genre_translations
    ADD CONSTRAINT genre_translations_tenant_genre_id_fkey FOREIGN KEY (tenant_id, genre_id) REFERENCES genres(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: genre_translations
ALTER TABLE genre_translations ENABLE ROW LEVEL SECURITY;

-- POLICY: genre_translations genre_translations_tenant_isolation
CREATE POLICY genre_translations_tenant_isolation ON genre_translations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- Every existing genre becomes one translation in its tenant's default locale,
-- carrying the name it held until now.
INSERT INTO genre_translations (id, genre_id, tenant_id, locale, name, created_at, updated_at)
SELECT uuidv7(), g.id, g.tenant_id, t.default_locale, g.name, g.created_at, g.created_at
FROM genres g
    JOIN tenants t ON t.id = g.tenant_id;

-- FUNCTION: genre_translation_for
-- The name of a genre to show for a locale: that locale's, else the tenant
-- default locale's, else the genre's oldest, as page_translation_for picks a
-- page's. An empty locale asks for the tenant default locale's.
--
-- It answers the row itself and a read joins it with CROSS JOIN LATERAL, for
-- the reason series_translation_for does.
--
-- SECURITY INVOKER keeps genre_translations behind the caller's own row-level
-- security, as page_translation_for does.
CREATE FUNCTION genre_translation_for(genre_id uuid, locale text) RETURNS SETOF genre_translations
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT gt.*
    FROM genre_translations gt
        JOIN tenants t ON t.id = gt.tenant_id
    WHERE gt.genre_id = genre_translation_for.genre_id
    ORDER BY (gt.locale = genre_translation_for.locale) DESC,
        (gt.locale = t.default_locale) DESC,
        gt.created_at,
        gt.id
    LIMIT 1
$$;
