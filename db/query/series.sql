-- The cursor pagination of the published series list runs in two stages.
--
-- Stage one is the four keyset scans below, which settle nothing but the ids
-- of one page. The sort key is (published_at, id) or (title, id); id is a
-- UUIDv7, so the order stays unique even when published_at or title ties.
-- Every sort order gets its own query with a fixed ORDER BY, because
-- branching with CASE stops the rows from being read in index order and puts
-- a full sort ahead of the LIMIT. As written, each query walks
-- idx_series_tenant_published_at or idx_series_tenant_title directly.
-- Backward calls the query of the reversed order, and the caller sorts the
-- rows back.
--
-- Stage two is ListActiveSeriesByIDs, which builds the display data for the
-- ids stage one settled on.
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

-- name: ListActiveSeriesByIDs :many
-- Display data for the published series, narrowed by tenant id.
-- No ORDER BY: the caller sorts the rows into the id order stage one settled
-- on.
SELECT s.id,
    s.public_id,
    s.title,
    sl.synopsis,
    s.published_at,
    s.eye_catch_image_id,
    NULL::timestamp AS eye_catch_image_updated_at,
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

-- name: LockSeriesByPublicIDForTenant :one
-- Lock the series row so concurrent CreateEpisode and ReorderEpisodes
-- calls serialize. The following read of the current order (or
-- MAX(order_index)) must be a separate statement: READ COMMITTED
-- freezes its snapshot at statement start, so waiting for the lock in
-- the same statement would still see the pre-wait rows.
SELECT id
FROM series
WHERE tenant_id = $1
    AND public_id = $2
FOR UPDATE;

-- name: GetSeriesDetail :one
SELECT s.id,
    s.public_id,
    s.title,
    l.public_id AS label_public_id,
    l.name AS label_name,
    s.eye_catch_image_id,
    NULL::timestamp AS eye_catch_image_updated_at,
    sl.synopsis,
    s.is_published,
    s.published_at,
    -- Collect the several creators into one column as a JSON array
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
    COALESCE(
        (
            SELECT json_agg(
                    json_build_object(
                        'public_id',
                        e.public_id,
                        'title',
                        e.title,
                        'order_index',
                        e.order_index,
                        'price',
                        el.price,
                        'reading_period_hours',
                        el.reading_period_hours,
                        'status',
                        el.status,
                        'scheduled_at',
                        el.scheduled_at,
                        'published_at',
                        el.published_at
                    )
                    ORDER BY e.order_index ASC
                )
            FROM episodes e
                JOIN episode_listings el ON el.episode_id = e.id
            WHERE e.series_id = s.id
                AND el.status = 'published'
                AND el.published_at IS NOT NULL
                AND el.published_at <= NOW()
        ),
        '[]'
    )::jsonb AS episodes
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN labels l ON s.label_id = l.id
    LEFT JOIN series_creators sc ON s.id = sc.series_id
    LEFT JOIN creators c ON sc.creator_id = c.id
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
WHERE s.public_id = $1
    AND s.tenant_id = $2
GROUP BY s.id,
    l.id,
    sl.series_id,
    sl.synopsis;

-- name: CreateSeriesBase :one
INSERT INTO series (
        id,
        tenant_id,
        label_id,
        public_id,
        title
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateSeriesBase :exec
UPDATE series
SET title = $2,
    label_id = $3,
    updated_at = NOW()
WHERE id = $1;

-- name: UpsertSeriesListing :one
INSERT INTO series_listings (
        tenant_id,
        series_id,
        synopsis,
        reading_period_hours
    )
VALUES (
        $1,
        $2,
        $3,
        $4
    ) ON CONFLICT (series_id) DO
UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours
RETURNING *;

-- name: UpdateSeriesPublication :exec
UPDATE series
SET published_at = sqlc.narg(published_at)::timestamptz,
    is_published = CASE
        WHEN sqlc.narg(published_at)::timestamptz IS NULL THEN false
        ELSE true
    END,
    updated_at = NOW()
WHERE id = $1;

-- Admin ListSeries is (created_at, id) DESC. Forward uses the DESC query;
-- backward uses ASC so idx_series_tenant_created_at can be scanned in
-- reverse. The handler flips ASC rows back into display order. id is a
-- UUIDv7, so the order stays unique even when created_at ties.
-- cursor rules: proto/README.md.
-- name: ListSeriesByTenantDesc :many
SELECT s.id,
    s.public_id,
    s.title,
    l.public_id AS label_public_id,
    l.name AS label_name,
    sl.synopsis,
    sl.reading_period_hours,
    s.is_published,
    s.published_at,
    s.created_at,
    s.eye_catch_image_id,
    si.updated_at AS eye_catch_image_updated_at,
    COALESCE(siv.file_size_bytes, 0)::bigint AS eye_catch_image_file_size_bytes
FROM series s
    LEFT JOIN labels l ON l.id = s.label_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN series_images si ON si.id = s.eye_catch_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM series_image_variants
        WHERE series_image_id = si.id
        ORDER BY width DESC
        LIMIT 1
    ) siv ON true
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.created_at, s.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.created_at, s.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY s.created_at DESC, s.id DESC
LIMIT sqlc.arg('limit');

-- name: ListSeriesByTenantAsc :many
SELECT s.id,
    s.public_id,
    s.title,
    l.public_id AS label_public_id,
    l.name AS label_name,
    sl.synopsis,
    sl.reading_period_hours,
    s.is_published,
    s.published_at,
    s.created_at,
    s.eye_catch_image_id,
    si.updated_at AS eye_catch_image_updated_at,
    COALESCE(siv.file_size_bytes, 0)::bigint AS eye_catch_image_file_size_bytes
FROM series s
    LEFT JOIN labels l ON l.id = s.label_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN series_images si ON si.id = s.eye_catch_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM series_image_variants
        WHERE series_image_id = si.id
        ORDER BY width DESC
        LIMIT 1
    ) siv ON true
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (s.created_at, s.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (s.created_at, s.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY s.created_at ASC, s.id ASC
LIMIT sqlc.arg('limit');

-- Resolves a currently public series to its internal ID and nothing else.
-- Shared by every member-facing RPC that acts on a series (follow, rating), so
-- they all treat a foreign, unpublished, or missing series the same way.
-- name: GetPublishedSeriesIDByPublicID :one
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.public_id = sqlc.arg('public_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
LIMIT 1;

-- name: GetSeriesByPublicIDForTenant :one
SELECT s.id,
    s.public_id,
    s.title,
    l.public_id AS label_public_id,
    l.name AS label_name,
    sl.synopsis,
    sl.reading_period_hours,
    s.is_published,
    s.published_at,
    s.eye_catch_image_id,
    si.updated_at AS eye_catch_image_updated_at,
    COALESCE(siv.file_size_bytes, 0)::bigint AS eye_catch_image_file_size_bytes
FROM series s
    LEFT JOIN labels l ON l.id = s.label_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id
    LEFT JOIN series_images si ON si.id = s.eye_catch_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM series_image_variants
        WHERE series_image_id = si.id
        ORDER BY width DESC
        LIMIT 1
    ) siv ON true
WHERE s.tenant_id = $1
    AND s.public_id = $2
LIMIT 1;

-- name: CountPublishedSeriesForTenant :one
-- For the tenant dashboard.
SELECT COUNT(*)::int AS published_series_count
FROM series
WHERE tenant_id = $1
    AND is_published = true;
