-- The published series list, in every shape the storefront reads it: the whole
-- catalogue, one creator's, one label's, and a keyword search. They are apart
-- from series.sql because they are one aggregate of their own — six stage-one
-- scans and the display query they all feed — and keeping them next to the
-- writes and the admin lists put both past the size at which a file stops
-- reading as a unit.
--
-- The cursor pagination of the published series list runs in two stages.
--
-- Stage one is the six keyset scans below, which settle nothing but the ids of
-- one page. The sort key is (published_at, id), (title, id), or
-- (latest_episode_at, id); id is a UUIDv7, so the order stays unique even when
-- the sorted value ties. Every sort order gets its own query with a fixed
-- ORDER BY, because branching with CASE stops the rows from being read in
-- index order and puts a full sort ahead of the LIMIT. The published_at and
-- title queries walk idx_series_tenant_published_at or idx_series_tenant_title
-- directly. Backward calls the query of the reversed order, and the caller
-- sorts the rows back.
--
-- Stage two is ListActiveSeriesByIDs, which builds the display data for the
-- ids stage one settled on.
--
-- Every stage-one query carries the same five filters, because a filter
-- narrows the list rather than ordering it and the token is bound to the set
-- that was on. Each is written as EXISTS so the planner may drive the scan
-- from either side: the ordering index when the filter keeps most of the
-- catalogue, and idx_series_genres_tenant_genre, idx_series_tags_tenant_tag,
-- idx_series_listings_tenant_status, or idx_series_listings_schedule_weekdays
-- when it keeps a handful.
--
-- What counts as a free episode is the published_free_episodes view, which
-- both stages read: stage one keeps only the series that have such an episode
-- when the caller asks for those, and stage two counts them into
-- free_episode_count, so a series the filter kept never reports none.
--
-- cursor rules: proto/README.md.
-- name: ListActiveSeriesIDsByPublishedAtDesc :many
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        NOT sqlc.arg('has_free_episodes')::boolean
        OR EXISTS (
            SELECT 1
            FROM published_free_episodes fe
            WHERE fe.series_id = s.id
        )
    )
    AND (
        sqlc.narg('genre_public_id')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_genres sg
                JOIN genres g ON g.id = sg.genre_id
            WHERE sg.tenant_id = sqlc.arg('tenant_id')
                AND sg.series_id = s.id
                AND g.public_id = sqlc.narg('genre_public_id')::text
        )
    )
    AND (
        sqlc.narg('tag_slug')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_tags st
                JOIN tags t ON t.id = st.tag_id
            WHERE st.tenant_id = sqlc.arg('tenant_id')
                AND st.series_id = s.id
                AND t.slug = sqlc.narg('tag_slug')::text
        )
    )
    AND (
        sqlc.narg('status')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_listings sl
            WHERE sl.tenant_id = sqlc.arg('tenant_id')
                AND sl.series_id = s.id
                AND sl.status = sqlc.narg('status')::text
        )
    )
    AND (
        sqlc.narg('weekday')::int2 IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_listings sl
            WHERE sl.tenant_id = sqlc.arg('tenant_id')
                AND sl.series_id = s.id
                AND sl.schedule_weekdays @> ARRAY[sqlc.narg('weekday')::int2]
        )
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.published_at, s.id) <= (
                sqlc.narg('cursor_published_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.published_at, s.id) < (
                sqlc.narg('cursor_published_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.published_at DESC,
    s.id DESC
LIMIT sqlc.arg('limit');

-- name: ListActiveSeriesIDsByPublishedAtAsc :many
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        NOT sqlc.arg('has_free_episodes')::boolean
        OR EXISTS (
            SELECT 1
            FROM published_free_episodes fe
            WHERE fe.series_id = s.id
        )
    )
    AND (
        sqlc.narg('genre_public_id')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_genres sg
                JOIN genres g ON g.id = sg.genre_id
            WHERE sg.tenant_id = sqlc.arg('tenant_id')
                AND sg.series_id = s.id
                AND g.public_id = sqlc.narg('genre_public_id')::text
        )
    )
    AND (
        sqlc.narg('tag_slug')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_tags st
                JOIN tags t ON t.id = st.tag_id
            WHERE st.tenant_id = sqlc.arg('tenant_id')
                AND st.series_id = s.id
                AND t.slug = sqlc.narg('tag_slug')::text
        )
    )
    AND (
        sqlc.narg('status')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_listings sl
            WHERE sl.tenant_id = sqlc.arg('tenant_id')
                AND sl.series_id = s.id
                AND sl.status = sqlc.narg('status')::text
        )
    )
    AND (
        sqlc.narg('weekday')::int2 IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_listings sl
            WHERE sl.tenant_id = sqlc.arg('tenant_id')
                AND sl.series_id = s.id
                AND sl.schedule_weekdays @> ARRAY[sqlc.narg('weekday')::int2]
        )
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.published_at, s.id) >= (
                sqlc.narg('cursor_published_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.published_at, s.id) > (
                sqlc.narg('cursor_published_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.published_at ASC,
    s.id ASC
LIMIT sqlc.arg('limit');

-- name: ListActiveSeriesIDsByTitleAsc :many
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        NOT sqlc.arg('has_free_episodes')::boolean
        OR EXISTS (
            SELECT 1
            FROM published_free_episodes fe
            WHERE fe.series_id = s.id
        )
    )
    AND (
        sqlc.narg('genre_public_id')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_genres sg
                JOIN genres g ON g.id = sg.genre_id
            WHERE sg.tenant_id = sqlc.arg('tenant_id')
                AND sg.series_id = s.id
                AND g.public_id = sqlc.narg('genre_public_id')::text
        )
    )
    AND (
        sqlc.narg('tag_slug')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_tags st
                JOIN tags t ON t.id = st.tag_id
            WHERE st.tenant_id = sqlc.arg('tenant_id')
                AND st.series_id = s.id
                AND t.slug = sqlc.narg('tag_slug')::text
        )
    )
    AND (
        sqlc.narg('status')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_listings sl
            WHERE sl.tenant_id = sqlc.arg('tenant_id')
                AND sl.series_id = s.id
                AND sl.status = sqlc.narg('status')::text
        )
    )
    AND (
        sqlc.narg('weekday')::int2 IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_listings sl
            WHERE sl.tenant_id = sqlc.arg('tenant_id')
                AND sl.series_id = s.id
                AND sl.schedule_weekdays @> ARRAY[sqlc.narg('weekday')::int2]
        )
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) >= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) > (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title ASC,
    s.id ASC
LIMIT sqlc.arg('limit');

-- name: ListActiveSeriesIDsByTitleDesc :many
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        NOT sqlc.arg('has_free_episodes')::boolean
        OR EXISTS (
            SELECT 1
            FROM published_free_episodes fe
            WHERE fe.series_id = s.id
        )
    )
    AND (
        sqlc.narg('genre_public_id')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_genres sg
                JOIN genres g ON g.id = sg.genre_id
            WHERE sg.tenant_id = sqlc.arg('tenant_id')
                AND sg.series_id = s.id
                AND g.public_id = sqlc.narg('genre_public_id')::text
        )
    )
    AND (
        sqlc.narg('tag_slug')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_tags st
                JOIN tags t ON t.id = st.tag_id
            WHERE st.tenant_id = sqlc.arg('tenant_id')
                AND st.series_id = s.id
                AND t.slug = sqlc.narg('tag_slug')::text
        )
    )
    AND (
        sqlc.narg('status')::text IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_listings sl
            WHERE sl.tenant_id = sqlc.arg('tenant_id')
                AND sl.series_id = s.id
                AND sl.status = sqlc.narg('status')::text
        )
    )
    AND (
        sqlc.narg('weekday')::int2 IS NULL
        OR EXISTS (
            SELECT 1
            FROM series_listings sl
            WHERE sl.tenant_id = sqlc.arg('tenant_id')
                AND sl.series_id = s.id
                AND sl.schedule_weekdays @> ARRAY[sqlc.narg('weekday')::int2]
        )
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) <= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) < (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title DESC,
    s.id DESC
LIMIT sqlc.arg('limit');

-- The latest-update order, and the only stage-one pair no index can serve.
-- Its sort key is the newest published episode of each series, which lives in
-- episode_listings rather than in a column of series, so the scan reads the
-- tenant's published series and sorts them. That is bounded by one tenant's
-- catalogue, and the per-series lookup walks idx_episodes_series_order_index
-- into the listing's primary key.
--
-- A series whose episodes are all still unpublished falls back to its own
-- publication instant, which is the last thing that happened to it. The
-- fallback is also what keeps the sort key non-null, so the keyset comparison
-- needs no ordering rule for a missing value.
--
-- latest_episode_at comes back with each row because the cursor is built from
-- it, the way ListRecommendedSeriesIDs hands back the rank it sorted by: a
-- caller that recomputed it would be reading a second NOW(), and a token built
-- on a value this query never sorted by points at the wrong page.
-- name: ListActiveSeriesIDsByLatestEpisodeAtDesc :many
WITH candidate AS (
    SELECT s.id,
        COALESCE(
            (
                SELECT max(el.published_at)
                FROM episodes e
                    JOIN episode_listings el ON el.episode_id = e.id
                WHERE e.series_id = s.id
                    AND el.status = 'published'
                    AND el.published_at IS NOT NULL
                    AND el.published_at <= NOW()
            ),
            s.published_at
        )::timestamptz AS latest_episode_at
    FROM series s
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND (
            NOT sqlc.arg('has_free_episodes')::boolean
            OR EXISTS (
                SELECT 1
                FROM published_free_episodes fe
                WHERE fe.series_id = s.id
            )
        )
        AND (
            sqlc.narg('genre_public_id')::text IS NULL
            OR EXISTS (
                SELECT 1
                FROM series_genres sg
                    JOIN genres g ON g.id = sg.genre_id
                WHERE sg.tenant_id = sqlc.arg('tenant_id')
                    AND sg.series_id = s.id
                    AND g.public_id = sqlc.narg('genre_public_id')::text
            )
        )
        AND (
            sqlc.narg('tag_slug')::text IS NULL
            OR EXISTS (
                SELECT 1
                FROM series_tags st
                    JOIN tags t ON t.id = st.tag_id
                WHERE st.tenant_id = sqlc.arg('tenant_id')
                    AND st.series_id = s.id
                    AND t.slug = sqlc.narg('tag_slug')::text
            )
        )
        AND (
            sqlc.narg('status')::text IS NULL
            OR EXISTS (
                SELECT 1
                FROM series_listings sl
                WHERE sl.tenant_id = sqlc.arg('tenant_id')
                    AND sl.series_id = s.id
                    AND sl.status = sqlc.narg('status')::text
            )
        )
        AND (
            sqlc.narg('weekday')::int2 IS NULL
            OR EXISTS (
                SELECT 1
                FROM series_listings sl
                WHERE sl.tenant_id = sqlc.arg('tenant_id')
                    AND sl.series_id = s.id
                    AND sl.schedule_weekdays @> ARRAY[sqlc.narg('weekday')::int2]
            )
        )
)
SELECT id,
    latest_episode_at
FROM candidate
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (latest_episode_at, id) <= (
                sqlc.narg('cursor_latest_episode_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (latest_episode_at, id) < (
                sqlc.narg('cursor_latest_episode_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY latest_episode_at DESC,
    id DESC
LIMIT sqlc.arg('limit');

-- name: ListActiveSeriesIDsByLatestEpisodeAtAsc :many
WITH candidate AS (
    SELECT s.id,
        COALESCE(
            (
                SELECT max(el.published_at)
                FROM episodes e
                    JOIN episode_listings el ON el.episode_id = e.id
                WHERE e.series_id = s.id
                    AND el.status = 'published'
                    AND el.published_at IS NOT NULL
                    AND el.published_at <= NOW()
            ),
            s.published_at
        )::timestamptz AS latest_episode_at
    FROM series s
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND (
            NOT sqlc.arg('has_free_episodes')::boolean
            OR EXISTS (
                SELECT 1
                FROM published_free_episodes fe
                WHERE fe.series_id = s.id
            )
        )
        AND (
            sqlc.narg('genre_public_id')::text IS NULL
            OR EXISTS (
                SELECT 1
                FROM series_genres sg
                    JOIN genres g ON g.id = sg.genre_id
                WHERE sg.tenant_id = sqlc.arg('tenant_id')
                    AND sg.series_id = s.id
                    AND g.public_id = sqlc.narg('genre_public_id')::text
            )
        )
        AND (
            sqlc.narg('tag_slug')::text IS NULL
            OR EXISTS (
                SELECT 1
                FROM series_tags st
                    JOIN tags t ON t.id = st.tag_id
                WHERE st.tenant_id = sqlc.arg('tenant_id')
                    AND st.series_id = s.id
                    AND t.slug = sqlc.narg('tag_slug')::text
            )
        )
        AND (
            sqlc.narg('status')::text IS NULL
            OR EXISTS (
                SELECT 1
                FROM series_listings sl
                WHERE sl.tenant_id = sqlc.arg('tenant_id')
                    AND sl.series_id = s.id
                    AND sl.status = sqlc.narg('status')::text
            )
        )
        AND (
            sqlc.narg('weekday')::int2 IS NULL
            OR EXISTS (
                SELECT 1
                FROM series_listings sl
                WHERE sl.tenant_id = sqlc.arg('tenant_id')
                    AND sl.series_id = s.id
                    AND sl.schedule_weekdays @> ARRAY[sqlc.narg('weekday')::int2]
            )
        )
)
SELECT id,
    latest_episode_at
FROM candidate
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (latest_episode_at, id) >= (
                sqlc.narg('cursor_latest_episode_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (latest_episode_at, id) > (
                sqlc.narg('cursor_latest_episode_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY latest_episode_at ASC,
    id ASC
LIMIT sqlc.arg('limit');

-- name: ListActiveSeriesByIDs :many
-- Display data for the published series, narrowed by tenant id.
-- No ORDER BY: the caller sorts the rows into the id order stage one settled
-- on.
SELECT s.id,
    s.public_id,
    s.title,
    sl.synopsis,
    sl.status,
    sl.schedule_weekdays,
    sl.age_rating,
    s.published_at,
    s.eye_catch_image_id,
    NULL::timestamp AS eye_catch_image_updated_at,
    (
        SELECT COUNT(*)
        FROM published_free_episodes fe
        WHERE fe.series_id = s.id
    )::int4 AS free_episode_count,
    COALESCE(
        json_agg(
            json_build_object(
                'public_id',
                c.public_id,
                'name',
                c.name,
                'role',
                sc.role,
                'profile_text',
                c.profile_text,
                'icon_image_url',
                CASE
                    WHEN c.icon_image_id IS NOT NULL THEN '/images/creators/' || c.icon_image_id::text
                    ELSE ''
                END,
                'icon_image_file_size_bytes',
                0,
                'icon_image_updated_at',
                COALESCE(ci.updated_at::TEXT, '')
            )
            ORDER BY sc.display_order ASC
        ) FILTER (
            WHERE c.id IS NOT NULL
        ),
        '[]'
    )::jsonb AS creators,
    -- The classification rides on this row rather than on queries of its own,
    -- so a page costs the round trips it did before series carried genres and
    -- tags. Both are sub-selects rather than joins because the row is already
    -- grouped for the creators, and a second and third join would multiply
    -- what that aggregate counts.
    COALESCE(
        (
            SELECT json_agg(
                    json_build_object(
                        'public_id',
                        g.public_id,
                        'name',
                        g.name,
                        'slug',
                        g.slug
                    )
                    -- The tenant's own genre order rather than the order the
                    -- series was assigned them in, so every series presents
                    -- them the way the genre list does.
                    ORDER BY g.display_order ASC,
                        g.id ASC
                )
            FROM series_genres sg
                JOIN genres g ON g.id = sg.genre_id
            WHERE sg.tenant_id = sqlc.arg('tenant_id')
                AND sg.series_id = s.id
        ),
        '[]'
    )::jsonb AS genres,
    COALESCE(
        (
            SELECT json_agg(
                    json_build_object(
                        'name',
                        t.name,
                        'slug',
                        t.slug
                    )
                    -- Tags have no order of their own, so they read back by
                    -- name: the same series shows the same list every time.
                    ORDER BY t.name ASC,
                        t.id ASC
                )
            FROM series_tags st
                JOIN tags t ON t.id = st.tag_id
            WHERE st.tenant_id = sqlc.arg('tenant_id')
                AND st.series_id = s.id
        ),
        '[]'
    )::jsonb AS tags,
    CASE
        WHEN l.public_id IS NOT NULL THEN json_build_object(
            'public_id',
            l.public_id,
            'name',
            l.name
        )
        ELSE '{}'::json
    END::jsonb AS label_info
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN labels l ON s.label_id = l.id
    LEFT JOIN series_creators sc ON s.id = sc.series_id
    LEFT JOIN creators c ON sc.creator_id = c.id
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = ANY(sqlc.arg('ids')::uuid [])
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
GROUP BY s.id,
    sl.series_id,
    sl.synopsis,
    sl.status,
    sl.schedule_weekdays,
    sl.age_rating,
    l.public_id,
    l.name;

-- name: ListPublishedSeriesIDsByCreatorTitleAsc :many
-- The related series of a creator detail page. A keyset scan on title + id.
-- The published predicate is the one ListActiveSeriesIDsByPublishedAtDesc
-- uses. Same shape as ListActiveSeriesIDsByTitleAsc, narrowed by creator.
-- Backward calls ListPublishedSeriesIDsByCreatorTitleDesc, and the caller
-- sorts the rows back.
SELECT s.id
FROM series s
    JOIN series_creators sc ON sc.series_id = s.id
WHERE sc.creator_id = sqlc.arg('creator_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) >= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) > (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title ASC,
    s.id ASC
LIMIT sqlc.arg('limit');

-- name: ListPublishedSeriesIDsByCreatorTitleDesc :many
-- The backward direction of ListPublishedSeriesIDsByCreatorTitleAsc.
SELECT s.id
FROM series s
    JOIN series_creators sc ON sc.series_id = s.id
WHERE sc.creator_id = sqlc.arg('creator_id')
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) <= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) < (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title DESC,
    s.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPublishedSeriesIDsByLabelTitleAsc :many
-- The related series of a label detail page. A keyset scan on title + id.
-- The published predicate is the one ListActiveSeriesIDsByPublishedAtDesc
-- uses. Same shape as ListActiveSeriesIDsByTitleAsc, narrowed by label_id.
-- Backward calls ListPublishedSeriesIDsByLabelTitleDesc, and the caller
-- sorts the rows back.
-- Index: idx_series_tenant_label_title
SELECT s.id
FROM series s
WHERE s.label_id = sqlc.arg('label_id')::uuid
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) >= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) > (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title ASC,
    s.id ASC
LIMIT sqlc.arg('limit');

-- name: ListPublishedSeriesIDsByLabelTitleDesc :many
-- The backward direction of ListPublishedSeriesIDsByLabelTitleAsc.
SELECT s.id
FROM series s
WHERE s.label_id = sqlc.arg('label_id')::uuid
    AND s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) <= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) < (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title DESC,
    s.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPublishedSeriesIDsBySearchTitleAsc :many
-- SearchPublishedSeries. Takes the published series whose title or synopsis
-- ILIKE-matches query_pattern, by a keyset on title + id.
-- The caller builds query_pattern as '%q%' and makes the ILIKE %/_ literal
-- with ESCAPE '!'.
-- Index plan: idx_series_tenant_title carries the keyset half. ILIKE '%q%'
-- cannot ride a btree, so a sequential scan is enough while the LIMIT still
-- bites after narrowing by tenant and is_published. Once the row count makes
-- the latency visible, add a pg_trgm GIN index on title and
-- series_listings.synopsis.
SELECT s.id
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        s.title ILIKE sqlc.arg('query_pattern')::text ESCAPE '!'
        OR COALESCE(sl.synopsis, '') ILIKE sqlc.arg('query_pattern')::text ESCAPE '!'
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) >= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) > (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title ASC,
    s.id ASC
LIMIT sqlc.arg('limit');

-- name: ListPublishedSeriesIDsBySearchTitleDesc :many
-- The backward direction of ListPublishedSeriesIDsBySearchTitleAsc.
SELECT s.id
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND (
        s.title ILIKE sqlc.arg('query_pattern')::text ESCAPE '!'
        OR COALESCE(sl.synopsis, '') ILIKE sqlc.arg('query_pattern')::text ESCAPE '!'
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) <= (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.title, s.id) < (
                sqlc.narg('cursor_title')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY s.title DESC,
    s.id DESC
LIMIT sqlc.arg('limit');

