-- FUNCTION: published_page_translation_for
CREATE OR REPLACE FUNCTION published_page_translation_for(page_id uuid, locale text) RETURNS uuid
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
