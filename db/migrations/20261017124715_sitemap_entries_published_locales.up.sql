-- COLUMN: episodes translation_deleted_at
-- When a translation of the episode was last deleted, and NULL until one is.
-- A deletion changes what the episode's page shows in that locale, and the
-- translations left behind keep no time that says so, so the sitemap's
-- last_modified_at reads it from here, as it reads a series' from
-- series.updated_at.
ALTER TABLE episodes
    ADD COLUMN translation_deleted_at timestamp with time zone;

-- VIEW: sitemap_entries
-- One row per page the storefront publishes for a tenant on a surface: its
-- published series, their published episodes, its labels, its creators, its
-- genres, and its pages. kind numbers them as SitemapEntryKind does, which is
-- also the order ListSitemapEntries walks them in.
--
-- Each branch asks the question the storefront's own reads ask of that kind,
-- so the sitemap never links a page that answers 404 and never leaves out one
-- a reader can open:
--
-- - a series is one ListActiveSeriesIDsByPublishedAtDesc lists
-- - an episode is one GetSeriesDetail lists under such a series
-- - a label is one label_surfaces puts on the surface
-- - a creator is one ListPublishedCreatorIDsByNameAsc lists
-- - a genre is any genre of the tenant, as ListPublishedGenresByTenantAsc has
-- - a page is one ListPublishedPageSlugsForTenant routes to
--
-- last_modified_at is taken from the rows and is NULL where they keep no such
-- time. A series counts its newest published episode, because its page lists
-- them, an episode counts its translations and the last time one of them was
-- deleted, and a page counts its published translations, whose updated_at
-- moves when one of them publishes a version.
--
-- published_locales is the set of locales a series, an episode, or a page has
-- a translation in that the tenant offers, which is the set its page names as
-- language alternates: every translation of a series or an episode, and the
-- published ones of a page, as published_page_translation_for serves them. It
-- is empty for a label, a creator, and a genre, which are shown in every
-- offered language. The set is unordered here, and ListSitemapEntries answers
-- it in registry order.
--
-- The labels come first only because a UNION takes its column types from its
-- first branch, and sqlc reads last_modified_at as nullable only where that
-- branch's is a NULL; the order a sitemap lists entries in is kind's.
--
-- Which episodes a reader can open on a surface is published_episode_surfaces'
-- question, so the episode branch and a series' newest episode read it rather
-- than testing the series, the listing, and the surface again; a copy here
-- would keep listing pages on a rule the storefront no longer applies. The
-- listing is joined only for the instant it was published at, which the view
-- does not carry.
--
-- It is a view because the ascending and the descending keyset queries ask the
-- same question, and spelling six branches out twice is how the two come to
-- disagree. security_invoker keeps the row-level security of every table it
-- reads the caller's own.
CREATE OR REPLACE VIEW sitemap_entries WITH (security_invoker = true) AS
WITH surfaces (surface) AS (
    VALUES ('web'::text),
        ('app'::text)
)
SELECT l.tenant_id,
    ls.surface,
    3 AS kind,
    l.id,
    l.public_id::text AS public_id,
    ''::text AS series_public_id,
    ''::text AS slug,
    NULL::timestamp with time zone AS last_modified_at,
    '{}'::text [] AS published_locales
FROM labels l
    JOIN label_surfaces ls ON ls.label_id = l.id
UNION ALL
SELECT s.tenant_id,
    ss.surface,
    1,
    s.id,
    s.public_id::text,
    ''::text,
    ''::text,
    GREATEST(
        s.updated_at,
        (
            SELECT MAX(el.published_at)
            FROM published_episode_surfaces pes
                JOIN episode_listings el ON el.episode_id = pes.episode_id
            WHERE pes.series_id = s.id
                AND pes.surface = ss.surface
        )
    )::timestamp with time zone,
    ARRAY(
        SELECT st.locale
        FROM series_translations st
        WHERE st.series_id = s.id
            AND st.locale = ANY (t.supported_locales)
    )::text []
FROM series s
    JOIN series_surfaces ss ON ss.series_id = s.id
    JOIN tenants t ON t.id = s.tenant_id
WHERE s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
UNION ALL
SELECT e.tenant_id,
    pes.surface,
    2,
    e.id,
    e.public_id::text,
    s.public_id::text,
    ''::text,
    GREATEST(
        el.published_at,
        e.translation_deleted_at,
        (
            SELECT MAX(et.updated_at)
            FROM episode_translations et
            WHERE et.episode_id = e.id
        )
    )::timestamp with time zone,
    ARRAY(
        SELECT et.locale
        FROM episode_translations et
        WHERE et.episode_id = e.id
            AND et.locale = ANY (t.supported_locales)
    )::text []
FROM published_episode_surfaces pes
    JOIN episodes e ON e.id = pes.episode_id
    JOIN series s ON s.id = pes.series_id
    JOIN episode_listings el ON el.episode_id = pes.episode_id
    JOIN tenants t ON t.id = e.tenant_id
UNION ALL
SELECT c.tenant_id,
    v.surface,
    4,
    c.id,
    c.public_id::text,
    ''::text,
    ''::text,
    NULL::timestamp with time zone,
    '{}'::text []
FROM creators c
    CROSS JOIN surfaces v
WHERE EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
            JOIN series_surfaces ss ON ss.series_id = s.id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
            AND ss.surface = v.surface
    )
UNION ALL
SELECT g.tenant_id,
    v.surface,
    5,
    g.id,
    g.public_id::text,
    ''::text,
    ''::text,
    NULL::timestamp with time zone,
    '{}'::text []
FROM genres g
    CROSS JOIN surfaces v
UNION ALL
SELECT p.tenant_id,
    v.surface,
    6,
    p.id,
    ''::text,
    ''::text,
    p.slug::text,
    GREATEST(
        p.updated_at,
        (
            SELECT MAX(pt.updated_at)
            FROM page_translations pt
            WHERE pt.page_id = p.id
                AND pt.published_version_id IS NOT NULL
        )
    )::timestamp with time zone,
    ARRAY(
        SELECT pt.locale
        FROM page_translations pt
        WHERE pt.page_id = p.id
            AND published_page_translation_for(p.id, pt.locale) = pt.id
    )::text []
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    CROSS JOIN surfaces v
WHERE published_page_translation_for(p.id, t.default_locale) IS NOT NULL;
