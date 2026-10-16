-- TABLE: series_translations
-- One locale's rendering of a series: its title and its synopsis. The series
-- itself keeps what every locale shares.
CREATE TABLE series_translations (
    id uuid NOT NULL,
    series_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    title text NOT NULL,
    synopsis text DEFAULT '' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT series_translations_locale_not_blank_check CHECK ((btrim(locale) <> ''))
);

-- CONSTRAINT: series_translations series_translations_pkey
ALTER TABLE ONLY series_translations
    ADD CONSTRAINT series_translations_pkey PRIMARY KEY (id);

-- CONSTRAINT: series_translations series_translations_series_id_locale_key
ALTER TABLE ONLY series_translations
    ADD CONSTRAINT series_translations_series_id_locale_key UNIQUE (series_id, locale);

-- FK CONSTRAINT: series_translations series_translations_tenant_id_fkey
ALTER TABLE ONLY series_translations
    ADD CONSTRAINT series_translations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_translations series_translations_tenant_series_id_fkey
ALTER TABLE ONLY series_translations
    ADD CONSTRAINT series_translations_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: series_translations
ALTER TABLE series_translations ENABLE ROW LEVEL SECURITY;

-- POLICY: series_translations series_translations_tenant_isolation
CREATE POLICY series_translations_tenant_isolation ON series_translations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: episode_translations
-- One locale's rendering of an episode: its title.
CREATE TABLE episode_translations (
    id uuid NOT NULL,
    episode_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    locale text NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT episode_translations_locale_not_blank_check CHECK ((btrim(locale) <> ''))
);

-- CONSTRAINT: episode_translations episode_translations_pkey
ALTER TABLE ONLY episode_translations
    ADD CONSTRAINT episode_translations_pkey PRIMARY KEY (id);

-- CONSTRAINT: episode_translations episode_translations_episode_id_locale_key
ALTER TABLE ONLY episode_translations
    ADD CONSTRAINT episode_translations_episode_id_locale_key UNIQUE (episode_id, locale);

-- FK CONSTRAINT: episode_translations episode_translations_tenant_id_fkey
ALTER TABLE ONLY episode_translations
    ADD CONSTRAINT episode_translations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_translations episode_translations_tenant_episode_id_fkey
ALTER TABLE ONLY episode_translations
    ADD CONSTRAINT episode_translations_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: episode_translations
ALTER TABLE episode_translations ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_translations episode_translations_tenant_isolation
CREATE POLICY episode_translations_tenant_isolation ON episode_translations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- Every existing series and episode becomes one translation in its tenant's
-- default locale, carrying the title and the synopsis it held until now.
INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis, created_at, updated_at)
SELECT uuidv7(), s.id, s.tenant_id, t.default_locale, s.title, COALESCE(sl.synopsis, ''), s.created_at, s.updated_at
FROM series s
    JOIN tenants t ON t.id = s.tenant_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id;

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title, created_at, updated_at)
SELECT uuidv7(), e.id, e.tenant_id, t.default_locale, e.title, e.created_at, e.created_at
FROM episodes e
    JOIN tenants t ON t.id = e.tenant_id;

-- FUNCTION: series_translation_for
-- The translation of a series to show for a locale: that locale's, else the
-- tenant default locale's, else the series' oldest, as page_translation_for
-- picks a page's. An empty locale asks for the tenant default locale's.
--
-- SECURITY INVOKER keeps series_translations behind the caller's own row-level
-- security, as page_translation_for does.
CREATE FUNCTION series_translation_for(series_id uuid, locale text) RETURNS uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT st.id
    FROM series_translations st
        JOIN tenants t ON t.id = st.tenant_id
    WHERE st.series_id = series_translation_for.series_id
    ORDER BY (st.locale = series_translation_for.locale) DESC,
        (st.locale = t.default_locale) DESC,
        st.created_at,
        st.id
    LIMIT 1
$$;

-- FUNCTION: episode_translation_for
-- The translation of an episode to show for a locale, picked the way
-- series_translation_for picks a series'.
CREATE FUNCTION episode_translation_for(episode_id uuid, locale text) RETURNS uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT et.id
    FROM episode_translations et
        JOIN tenants t ON t.id = et.tenant_id
    WHERE et.episode_id = episode_translation_for.episode_id
    ORDER BY (et.locale = episode_translation_for.locale) DESC,
        (et.locale = t.default_locale) DESC,
        et.created_at,
        et.id
    LIMIT 1
$$;
