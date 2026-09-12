-- A series as one row: locked, read, written, and listed for the console. The
-- keyset scans behind the public series list are in published_series.sql.

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
    sl.status,
    sl.schedule_weekdays,
    sl.age_rating,
    -- The series' own comment mode, and NULL when it follows the tenant's. The
    -- caller resolves the two, so this read carries the override rather than
    -- the answer.
    sl.comment_mode,
    s.is_published,
    s.published_at,
    (
        SELECT COUNT(*)
        FROM published_free_episodes fe
        WHERE fe.series_id = s.id
    )::int4 AS free_episode_count,
    -- Collect the several creators into one column as a JSON array
    COALESCE(
        json_agg(
            json_build_object(
                    'public_id',
                    c.public_id,
                'name',
                c.name,
                    'role_public_id',
                    cr.public_id,
                    'role_name',
                    cr.name,
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
            -- Role priority first, so the leading role opens the list. A
            -- credit written before roles existed states none and comes last.
            ORDER BY cr.display_priority ASC NULLS LAST,
                sc.display_order ASC,
                c.name ASC
        ) FILTER (
            WHERE c.id IS NOT NULL
        ),
        '[]'
    )::jsonb AS creators,
    -- The classification the list carries, so a detail page states the same
    -- genres and tags a card did. Sub-selects rather than joins, because this
    -- row is already grouped for the creators.
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
                    ORDER BY g.display_order ASC,
                        g.id ASC
                )
            FROM series_genres sg
                JOIN genres g ON g.id = sg.genre_id
            WHERE sg.series_id = s.id
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
                    ORDER BY t.name ASC,
                        t.id ASC
                )
            FROM series_tags st
                JOIN tags t ON t.id = st.tag_id
            WHERE st.series_id = s.id
        ),
        '[]'
    )::jsonb AS tags,
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
                    -- order_index can tie, so the UUIDv7 id is the
                    -- tiebreaker that keeps the order unique. It is the order
                    -- the episode detail's neighbour links are found in, and
                    -- the two have to agree: a reader following "next" from
                    -- this list must land where the list said they would.
                    ORDER BY e.order_index ASC,
                        e.id ASC
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
    LEFT JOIN creator_roles cr ON cr.id = sc.role_id
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
WHERE s.public_id = $1
    AND s.tenant_id = $2
GROUP BY s.id,
    l.id,
    sl.series_id,
    sl.synopsis,
    sl.status,
    sl.schedule_weekdays,
    sl.age_rating,
    sl.comment_mode;

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
-- The whole listing row is written on every admin save, so a field the
-- request leaves empty is stored as empty rather than kept from the row that
-- was there.
INSERT INTO series_listings (
        tenant_id,
        series_id,
        synopsis,
        reading_period_hours,
        status,
        schedule_weekdays,
        age_rating,
        comment_mode
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('series_id'),
        sqlc.arg('synopsis'),
        sqlc.arg('reading_period_hours'),
        sqlc.arg('status'),
        sqlc.arg('schedule_weekdays'),
        sqlc.arg('age_rating'),
        sqlc.narg('comment_mode')
    ) ON CONFLICT (series_id) DO
UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    schedule_weekdays = EXCLUDED.schedule_weekdays,
    age_rating = EXCLUDED.age_rating,
    comment_mode = EXCLUDED.comment_mode
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
    sl.status,
    sl.schedule_weekdays,
    sl.age_rating,
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
        sqlc.narg('status')::text IS NULL
        OR sl.status = sqlc.narg('status')::text
    )
    AND (
        sqlc.narg('age_rating')::text IS NULL
        OR sl.age_rating = sqlc.narg('age_rating')::text
    )
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
    sl.status,
    sl.schedule_weekdays,
    sl.age_rating,
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
        sqlc.narg('status')::text IS NULL
        OR sl.status = sqlc.narg('status')::text
    )
    AND (
        sqlc.narg('age_rating')::text IS NULL
        OR sl.age_rating = sqlc.narg('age_rating')::text
    )
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
    sl.status,
    sl.schedule_weekdays,
    sl.age_rating,
    sl.comment_mode,
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
