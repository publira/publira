-- name: GetTenantByDomain :one
-- ホスト名からテナントを特定する (Interceptorで使用)
SELECT *
FROM tenants
WHERE domain = $1
    OR subdomain = $1
LIMIT 1;
-- name: GetTenantThemeByTenantID :one
SELECT *
FROM tenant_themes
WHERE tenant_id = $1;
-- name: UpsertTenantTheme :one
INSERT INTO tenant_themes (
        tenant_id,
        primary_color,
        secondary_color,
        accent_color,
        logo_url,
        updated_at
    )
VALUES ($1, $2, $3, $4, $5, NOW()) ON CONFLICT (tenant_id) DO
UPDATE
SET primary_color = EXCLUDED.primary_color,
    secondary_color = EXCLUDED.secondary_color,
    accent_color = EXCLUDED.accent_color,
    logo_url = EXCLUDED.logo_url,
    updated_at = NOW()
RETURNING *;
-- name: CreateSession :one
INSERT INTO sessions (
        id,
        tenant_id,
        user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: GetSessionByTokenHashForTenant :one
SELECT *
FROM sessions
WHERE tenant_id = $1
    AND token_hash = $2
LIMIT 1;
-- name: RevokeSession :exec
UPDATE sessions
SET revoked_at = NOW()
WHERE id = $1
    AND tenant_id = $2;
-- name: GetUserByEmailForTenant :one
SELECT *
FROM users
WHERE tenant_id = $1
    AND email = $2
LIMIT 1;
-- name: GetUserByID :one
SELECT *
FROM users
WHERE id = $1;
-- name: ListActiveSeries :many
-- 公開中のシリーズ一覧を取得する (テナントIDで絞り込み)
SELECT s.id,
    s.public_id,
    s.title,
    s.synopsis,
    s.published_at
FROM series s
WHERE s.tenant_id = $1
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
ORDER BY s.published_at DESC
LIMIT $2 OFFSET $3;
-- name: CreateEpisodeBase :one
-- エピソードのBaseレコードを作成する
INSERT INTO episodes (
        id,
        series_id,
        public_id,
        title,
        order_index
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;
-- name: UpsertEpisodeListing :one
INSERT INTO episode_listings (
        episode_id,
        price,
        reading_period_hours,
        status,
        scheduled_at,
        published_at
    )
VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (episode_id) DO
UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at
RETURNING *;
-- name: ListEpisodesReadyToPublish :many
SELECT el.episode_id
FROM episode_listings el
WHERE el.status = 'scheduled'
    AND el.scheduled_at IS NOT NULL
    AND el.scheduled_at <= NOW();
-- name: MarkEpisodePublished :exec
UPDATE episode_listings
SET status = 'published',
    published_at = NOW()
WHERE episode_id = $1;
-- name: ListPublishedEpisodesBySeries :many
SELECT e.id,
    e.series_id,
    e.public_id,
    e.title,
    e.order_index,
    e.created_at,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON e.id = el.episode_id
WHERE s.tenant_id = $1
    AND e.series_id = $2
    AND el.status = 'published'
ORDER BY e.order_index ASC;
-- name: GetSeriesDetail :one
SELECT s.id,
    s.public_id,
    s.title,
    l.name AS label_name,
    s.synopsis,
    s.is_published,
    s.published_at,
    -- 複数のクリエイター情報をJSON配列として1カラムにまとめる
    COALESCE(
        json_agg(
            json_build_object(
                'name',
                c.name,
                'role',
                sc.role
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
    LEFT JOIN labels l ON s.label_id = l.id
    LEFT JOIN series_creators sc ON s.id = sc.series_id
    LEFT JOIN creators c ON sc.creator_id = c.id
WHERE s.public_id = $1
    AND s.tenant_id = $2
GROUP BY s.id,
    l.id;
-- name: GetTenantByPublicID :one
SELECT *
FROM tenants
WHERE public_id = $1
LIMIT 1;
-- name: GetLabelByPublicIDForTenant :one
SELECT *
FROM labels
WHERE tenant_id = $1
    AND public_id = $2
LIMIT 1;
-- name: CreateSeriesBase :one
INSERT INTO series (
        id,
        tenant_id,
        label_id,
        public_id,
        title,
        updated_at
    )
VALUES ($1, $2, $3, $4, $5, NOW())
RETURNING *;
-- name: UpdateSeriesBase :exec
UPDATE series
SET title = $2,
    label_id = $3,
    updated_at = NOW()
WHERE id = $1;
-- name: UpsertSeriesListing :one
UPDATE series
SET synopsis = $2,
    reading_period_hours = $3,
    is_published = $4,
    published_at = CASE
        WHEN $4 THEN COALESCE(series.published_at, NOW())
        ELSE NULL
    END,
    updated_at = NOW()
WHERE id = $1
RETURNING id AS series_id,
    synopsis,
    reading_period_hours,
    is_published,
    published_at;
-- name: ListSeriesByTenant :many
SELECT s.id,
    s.public_id,
    s.title,
    s.synopsis,
    s.is_published,
    s.published_at
FROM series s
WHERE s.tenant_id = $1
ORDER BY s.created_at DESC
LIMIT $2 OFFSET $3;
-- name: GetSeriesByPublicIDForTenant :one
SELECT s.id,
    s.public_id,
    s.title,
    s.synopsis,
    s.is_published,
    s.published_at
FROM series s
WHERE s.tenant_id = $1
    AND s.public_id = $2
LIMIT 1;
-- name: GetEpisodeByPublicIDForTenant :one
SELECT e.id,
    e.public_id,
    e.title,
    e.order_index,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND e.public_id = $2
LIMIT 1;
-- name: CreateEpisodeImage :one
INSERT INTO episode_images (
        id,
        tenant_id,
        episode_id,
        storage_provider,
        object_key,
        image_url,
        content_type,
        file_size_bytes,
    display_order,
    width,
    height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;
-- name: ListEpisodeImagesByEpisodeID :many
SELECT *
FROM episode_images
WHERE episode_id = $1
ORDER BY display_order ASC,
    created_at ASC;
-- name: UpdateEpisodePublishScheduleByPublicIDForTenant :exec
UPDATE episode_listings el
SET status = CASE
        WHEN $3 IS NULL THEN 'draft'
        ELSE 'scheduled'
    END,
    scheduled_at = $3,
    published_at = CASE
        WHEN $3 IS NULL THEN NULL
        ELSE el.published_at
    END
FROM episodes e
    JOIN series s ON s.id = e.series_id
WHERE el.episode_id = e.id
    AND s.tenant_id = $1
    AND e.public_id = $2;