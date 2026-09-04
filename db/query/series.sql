-- 公開シリーズ一覧の cursor ページネーションは 2 段構えになっている。
--
-- 1 段目がここに並ぶ 4 本のキーセット走査で、1 ページぶんの id だけを決める。
-- 並び替えキーは (published_at, id) か (title, id)。id は UUIDv7 なので、
-- published_at や title が同着でも一意に決まる。ORDER BY を並び順ごとに
-- 固定した別のクエリに分けてあるのは、CASE で分岐させると索引順に読めなく
-- なり、LIMIT の手前で全件ソートが入るため。それぞれ
-- idx_series_tenant_published_at / idx_series_tenant_title をそのまま辿る。
-- 前ページ方向は、並び順を反転した側のクエリを呼んで呼び出し側で並べ直す。
--
-- 2 段目が ListActiveSeriesByIDs で、決まった id の表示内容だけを組み立てる。
--
-- cursor の共通仕様は proto/README.md を参照。
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
-- 公開中のシリーズの表示内容を取得する (テナントIDで絞り込み)
-- 並び順は付けない。1 段目が決めた id の順に呼び出し側が並べ直す。
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
-- 著者詳細の関連シリーズ。タイトル + id のキーセット走査。公開判定は
-- ListActiveSeriesIDsByPublishedAtDesc と同じ述語。
-- ListActiveSeriesIDsByTitleAsc と同じ形で、creator で絞る。
-- 前ページ方向は ListPublishedSeriesIDsByCreatorTitleDesc を呼んで
-- 呼び出し側で並べ直す。
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
-- ListPublishedSeriesIDsByCreatorTitleAsc の前ページ方向。
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
-- レーベル詳細の関連シリーズ。タイトル + id のキーセット走査。公開判定は
-- ListActiveSeriesIDsByPublishedAtDesc と同じ述語。
-- ListActiveSeriesIDsByTitleAsc と同じ形で、label_id で絞る。
-- 前ページ方向は ListPublishedSeriesIDsByLabelTitleDesc を呼んで
-- 呼び出し側で並べ直す。
-- 索引: idx_series_tenant_label_title
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
-- ListPublishedSeriesIDsByLabelTitleAsc の前ページ方向。
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
-- SearchPublishedSeries。タイトルまたはあらすじが query_pattern に
-- ILIKE マッチする公開シリーズをタイトル + id のキーセットで取る。
-- query_pattern は呼び出し側が '%q%' に組み立て、ILIKE の %/_ は
-- ESCAPE '!' でリテラルにする。
-- 索引方針: idx_series_tenant_title がキーセット半を担う。ILIKE '%q%' は
-- btree に乗らないので、テナント + is_published で絞ったうえで LIMIT が
-- 効くうちはシーケンシャルで足りる。件数が増えて遅延が見えたら title と
-- series_listings.synopsis に pg_trgm GIN を足す。
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
-- ListPublishedSeriesIDsBySearchTitleAsc の前ページ方向。
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
    -- 複数の著者情報をJSON配列として1カラムにまとめる
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

-- Admin ListSeries は (created_at, id) の降順で表示する。
-- 次ページは降順、前ページは昇順のクエリで idx_series_tenant_created_at を
-- 走査し、前ページだけ handler で表示順へ戻す。id は UUIDv7 なので created_at
-- が同着でも並びが一意に決まる。cursor の共通仕様は proto/README.md を参照。
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
-- テナントの公開中シリーズ数を取得する（ダッシュボード用）
SELECT COUNT(*)::int AS published_series_count
FROM series
WHERE tenant_id = $1
    AND is_published = true;
