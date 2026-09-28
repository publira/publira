-- FUNCTION: published_page_translation_for
-- The translation of a page to serve a reader in a locale: among the
-- translations whose live version is published, that locale's, else the tenant
-- default locale's, else the page's oldest. NULL when no translation is live,
-- so a draft translation never stands in for one that is published.
--
-- SECURITY INVOKER keeps page_translations and page_versions behind the
-- caller's own row-level security, as page_translation_for does.
CREATE FUNCTION published_page_translation_for(page_id uuid, locale text) RETURNS uuid
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT pt.id
    FROM page_translations pt
        JOIN tenants t ON t.id = pt.tenant_id
        JOIN page_versions pv ON pv.id = pt.published_version_id
    WHERE pt.page_id = published_page_translation_for.page_id
        AND pv.status = 'published'
        AND pv.published_at IS NOT NULL
        AND pv.published_at <= now()
    ORDER BY (pt.locale = published_page_translation_for.locale) DESC,
        (pt.locale = t.default_locale) DESC,
        pt.created_at,
        pt.id
    LIMIT 1
$$;
