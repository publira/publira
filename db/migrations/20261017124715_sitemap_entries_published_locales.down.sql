-- The view gains a column, which CREATE OR REPLACE VIEW cannot take away
-- again, so the previous definition is created anew.
DROP VIEW sitemap_entries;

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
-- them, and a page counts its published translations, whose updated_at moves
-- when one of them publishes a version.
--
-- The episodes come first only because a UNION takes its column types from its
-- first branch, and theirs is the one whose last_modified_at is a nullable
-- column; the order a sitemap lists entries in is kind's.
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
CREATE VIEW sitemap_entries WITH (security_invoker = true) AS
WITH surfaces (surface) AS (
    VALUES ('web'::text),
        ('app'::text)
)
SELECT e.tenant_id,
    pes.surface,
    2 AS kind,
    e.id,
    e.public_id::text AS public_id,
    s.public_id::text AS series_public_id,
    ''::text AS slug,
    el.published_at AS last_modified_at
FROM published_episode_surfaces pes
    JOIN episodes e ON e.id = pes.episode_id
    JOIN series s ON s.id = pes.series_id
    JOIN episode_listings el ON el.episode_id = pes.episode_id
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
    )::timestamp with time zone
FROM series s
    JOIN series_surfaces ss ON ss.series_id = s.id
WHERE s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
UNION ALL
SELECT l.tenant_id,
    ls.surface,
    3,
    l.id,
    l.public_id::text,
    ''::text,
    ''::text,
    NULL::timestamp with time zone
FROM labels l
    JOIN label_surfaces ls ON ls.label_id = l.id
UNION ALL
SELECT c.tenant_id,
    v.surface,
    4,
    c.id,
    c.public_id::text,
    ''::text,
    ''::text,
    NULL::timestamp with time zone
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
    NULL::timestamp with time zone
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
    )::timestamp with time zone
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    CROSS JOIN surfaces v
WHERE published_page_translation_for(p.id, t.default_locale) IS NOT NULL;

ALTER TABLE episodes
    DROP COLUMN translation_deleted_at;
