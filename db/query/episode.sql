-- name: CreateEpisodeBase :one
INSERT INTO episodes (
        id,
        series_id,
        public_id,
        title,
        order_index,
        tenant_id
    )
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpsertEpisodeListing :one
INSERT INTO episode_listings (
        episode_id,
        price,
        reading_period_hours,
        status,
        scheduled_at,
        published_at,
        tenant_id
    )
VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (episode_id) DO
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

-- name: ListEpisodesReadyToPublishWithTenantInfo :many
SELECT el.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    t.id AS tenant_id,
    t.public_id AS tenant_public_id,
    t.name AS tenant_name,
    t.domain AS tenant_domain
FROM episode_listings el
    JOIN episodes e ON e.id = el.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN tenants t ON t.id = el.tenant_id
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

-- Reordering has to see every episode under the series, so this stays a list
-- without pagination. The list on screen uses the keyset scan below.
-- The order is (order_index, id), the same as ListEpisodes: ReorderEpisodes
-- compares it against what the client read back, and a different tiebreaker
-- would reject a request that never conflicted.
-- name: ListEpisodesBySeriesForTenant :many
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
    AND s.public_id = $2
ORDER BY e.order_index ASC,
    e.id ASC;

-- Admin ListEpisodes is (order_index, id) ASC. Forward uses the ASC query;
-- backward uses DESC so idx_episodes_series_order_index can be scanned in
-- reverse. The handler flips DESC rows back into display order. order_index
-- can tie, so the UUIDv7 id is the tiebreaker that keeps the order unique.
-- cursor rules: proto/README.md.
-- name: ListEpisodesBySeriesForTenantAsc :many
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
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.public_id = sqlc.arg('public_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (e.order_index, e.id) >= (sqlc.narg('cursor_order_index')::int4, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (e.order_index, e.id) > (sqlc.narg('cursor_order_index')::int4, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY e.order_index ASC,
    e.id ASC
LIMIT sqlc.arg('limit');

-- name: ListEpisodesBySeriesForTenantDesc :many
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
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.public_id = sqlc.arg('public_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (e.order_index, e.id) <= (sqlc.narg('cursor_order_index')::int4, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (e.order_index, e.id) < (sqlc.narg('cursor_order_index')::int4, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY e.order_index DESC,
    e.id DESC
LIMIT sqlc.arg('limit');

-- name: GetMaxEpisodeOrderIndexBySeriesForTenant :one
SELECT COALESCE(MAX(e.order_index), 0)::int4 AS max_order_index
FROM episodes e
    JOIN series s ON s.id = e.series_id
WHERE s.tenant_id = $1
    AND s.public_id = $2;

-- name: UpdateEpisodeOrderIndexByPublicIDForTenantAndSeries :exec
UPDATE episodes e
SET order_index = $4
FROM series s
WHERE e.series_id = s.id
    AND s.tenant_id = $1
    AND s.public_id = $2
    AND e.public_id = $3;

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

-- name: GetEpisodeByPublicIDForTenantAndSeries :one
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
    AND s.public_id = $2
    AND e.public_id = $3
LIMIT 1;

-- name: GetPublishedEpisodeByPublicIDForTenant :one
SELECT e.id,
    e.public_id,
    e.title,
    e.order_index,
    e.series_id,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND e.public_id = $2
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
LIMIT 1;

-- name: MarkPublishedEpisodeAsRead :one
-- Inserts the first completed read only after checking publication and body
-- access in the same statement. A duplicate returns the preserved read_at.
--
-- The returned id is likewise the one the first insert stored, so a repeated
-- notification projects onto the same content_events row rather than a second
-- completion for the same member and episode.
INSERT INTO episode_reads (id, tenant_id, user_id, episode_id)
SELECT sqlc.arg('id'), sqlc.arg('tenant_id'), sqlc.arg('user_id'), e.id
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND e.public_id = sqlc.arg('episode_public_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
    AND (
        el.price = 0
        OR EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = sqlc.arg('tenant_id')
                AND p.user_id = sqlc.arg('user_id')
                AND p.episode_id = e.id
                AND (p.expires_at IS NULL OR p.expires_at > NOW())
        )
        OR EXISTS (
            SELECT 1
            FROM access_tickets at
            WHERE at.tenant_id = sqlc.arg('tenant_id')
                AND at.user_id = sqlc.arg('user_id')
                AND at.episode_id = e.id
                AND at.revoked_at IS NULL
                AND (at.expires_at IS NULL OR at.expires_at > NOW())
        )
    )
ON CONFLICT (tenant_id, user_id, episode_id) DO UPDATE
SET read_at = episode_reads.read_at
RETURNING *;

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

-- name: CountDraftEpisodesForTenant :one
-- For the tenant dashboard.
SELECT COUNT(*)::int AS draft_episode_count
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND el.status = 'draft';

-- name: CountScheduledEpisodesForTenant :one
-- For the tenant dashboard.
SELECT COUNT(*)::int AS scheduled_episode_count
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND el.status = 'scheduled';

-- name: ListRecentEpisodesForDashboard :many
-- The most recent draft and scheduled episodes, for the publish queue on the
-- dashboard.
SELECT
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title,
    el.status,
    el.scheduled_at
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = $1
    AND el.status IN ('draft', 'scheduled')
ORDER BY
    CASE WHEN el.status = 'scheduled' THEN 0 ELSE 1 END ASC,
    el.scheduled_at ASC NULLS LAST,
    e.created_at DESC
LIMIT $2;
