-- Durable member follows (#1128). Episode, series, and creator follows have
-- distinct source tables; content_events must not be used to model any of them.

-- name: CreateEpisodeFollow :one
INSERT INTO episode_follows (tenant_id, user_id, episode_id)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('episode_id')
)
ON CONFLICT (tenant_id, user_id, episode_id) DO NOTHING
RETURNING *;

-- name: DeleteEpisodeFollow :execrows
DELETE FROM episode_follows
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND episode_id = sqlc.arg('episode_id');

-- name: CreateCreatorFollow :one
INSERT INTO creator_follows (tenant_id, user_id, creator_id)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('creator_id')
)
ON CONFLICT (tenant_id, user_id, creator_id) DO NOTHING
RETURNING *;

-- name: DeleteCreatorFollow :execrows
DELETE FROM creator_follows
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND creator_id = sqlc.arg('creator_id');

-- name: CreateSeriesFollow :one
INSERT INTO series_follows (tenant_id, user_id, series_id)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('series_id')
)
ON CONFLICT (tenant_id, user_id, series_id) DO NOTHING
RETURNING *;

-- name: DeleteSeriesFollow :execrows
DELETE FROM series_follows
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND series_id = sqlc.arg('series_id');

-- name: GetPublishedSeriesByPublicIDForFollow :one
SELECT s.id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.public_id = sqlc.arg('public_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
LIMIT 1;

-- name: ListUserFollowsByCreatedAtDesc :many
-- The API can expose one timeline while keeping each relationship's storage
-- and future aggregates independent. Public joins make a target that is no
-- longer visible disappear from this member's list without revealing why.
SELECT target_type,
    target_id,
    created_at
FROM (
    SELECT 'episode'::text AS target_type,
        ef.episode_id AS target_id,
        ef.created_at
    FROM episode_follows ef
        JOIN episodes e ON e.tenant_id = ef.tenant_id
            AND e.id = ef.episode_id
        JOIN series s ON s.tenant_id = e.tenant_id
            AND s.id = e.series_id
        JOIN episode_listings el ON el.tenant_id = e.tenant_id
            AND el.episode_id = e.id
    WHERE ef.tenant_id = sqlc.arg('tenant_id')
        AND ef.user_id = sqlc.arg('user_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
    UNION ALL
    SELECT 'creator'::text AS target_type,
        cf.creator_id AS target_id,
        cf.created_at
    FROM creator_follows cf
        JOIN creators c ON c.tenant_id = cf.tenant_id
            AND c.id = cf.creator_id
    WHERE cf.tenant_id = sqlc.arg('tenant_id')
        AND cf.user_id = sqlc.arg('user_id')
        AND EXISTS (
            SELECT 1
            FROM series_creators sc
                JOIN series s ON s.id = sc.series_id
            WHERE sc.tenant_id = c.tenant_id
                AND sc.creator_id = c.id
                AND s.tenant_id = c.tenant_id
                AND s.is_published = true
                AND s.published_at IS NOT NULL
                AND s.published_at <= NOW()
        )
    UNION ALL
    SELECT 'series'::text AS target_type,
        sf.series_id AS target_id,
        sf.created_at
    FROM series_follows sf
        JOIN series s ON s.tenant_id = sf.tenant_id
            AND s.id = sf.series_id
    WHERE sf.tenant_id = sqlc.arg('tenant_id')
        AND sf.user_id = sqlc.arg('user_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
) AS follows
WHERE sqlc.narg('cursor_created_at')::timestamptz IS NULL
    OR (
        sqlc.arg('cursor_inclusive')::boolean
        AND (created_at, target_type, target_id) <= (
            sqlc.narg('cursor_created_at')::timestamptz,
            sqlc.narg('cursor_target_type')::text,
            sqlc.narg('cursor_target_id')::uuid
        )
    )
    OR (
        NOT sqlc.arg('cursor_inclusive')::boolean
        AND (created_at, target_type, target_id) < (
            sqlc.narg('cursor_created_at')::timestamptz,
            sqlc.narg('cursor_target_type')::text,
            sqlc.narg('cursor_target_id')::uuid
        )
    )
ORDER BY created_at DESC,
    target_type ASC,
    target_id ASC
LIMIT sqlc.arg('limit');

-- name: ListUserFollowsByCreatedAtAsc :many
-- The previous-page half of ListUserFollowsByCreatedAtDesc. The handler reverses
-- the returned rows to preserve the public newest-first display order.
SELECT target_type,
    target_id,
    created_at
FROM (
    SELECT 'episode'::text AS target_type,
        ef.episode_id AS target_id,
        ef.created_at
    FROM episode_follows ef
        JOIN episodes e ON e.tenant_id = ef.tenant_id
            AND e.id = ef.episode_id
        JOIN series s ON s.tenant_id = e.tenant_id
            AND s.id = e.series_id
        JOIN episode_listings el ON el.tenant_id = e.tenant_id
            AND el.episode_id = e.id
    WHERE ef.tenant_id = sqlc.arg('tenant_id')
        AND ef.user_id = sqlc.arg('user_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
    UNION ALL
    SELECT 'creator'::text AS target_type,
        cf.creator_id AS target_id,
        cf.created_at
    FROM creator_follows cf
        JOIN creators c ON c.tenant_id = cf.tenant_id
            AND c.id = cf.creator_id
    WHERE cf.tenant_id = sqlc.arg('tenant_id')
        AND cf.user_id = sqlc.arg('user_id')
        AND EXISTS (
            SELECT 1
            FROM series_creators sc
                JOIN series s ON s.id = sc.series_id
            WHERE sc.tenant_id = c.tenant_id
                AND sc.creator_id = c.id
                AND s.tenant_id = c.tenant_id
                AND s.is_published = true
                AND s.published_at IS NOT NULL
                AND s.published_at <= NOW()
        )
    UNION ALL
    SELECT 'series'::text AS target_type,
        sf.series_id AS target_id,
        sf.created_at
    FROM series_follows sf
        JOIN series s ON s.tenant_id = sf.tenant_id
            AND s.id = sf.series_id
    WHERE sf.tenant_id = sqlc.arg('tenant_id')
        AND sf.user_id = sqlc.arg('user_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
) AS follows
WHERE sqlc.narg('cursor_created_at')::timestamptz IS NULL
    OR (
        sqlc.arg('cursor_inclusive')::boolean
        AND (created_at, target_type, target_id) >= (
            sqlc.narg('cursor_created_at')::timestamptz,
            sqlc.narg('cursor_target_type')::text,
            sqlc.narg('cursor_target_id')::uuid
        )
    )
    OR (
        NOT sqlc.arg('cursor_inclusive')::boolean
        AND (created_at, target_type, target_id) > (
            sqlc.narg('cursor_created_at')::timestamptz,
            sqlc.narg('cursor_target_type')::text,
            sqlc.narg('cursor_target_id')::uuid
        )
    )
ORDER BY created_at ASC,
    target_type DESC,
    target_id DESC
LIMIT sqlc.arg('limit');

-- These projections are used only while constructing the public Follow API
-- response. The follow relations and their cursor queries remain UUID-only.
-- name: ListPublishedEpisodeFollowTargetPublicIDsByIDs :many
SELECT e.id,
    e.public_id
FROM episodes e
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
    JOIN episode_listings el ON el.tenant_id = e.tenant_id
        AND el.episode_id = e.id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.id = ANY(sqlc.arg('ids')::uuid [])
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW();

-- name: ListPublishedCreatorFollowTargetPublicIDsByIDs :many
SELECT c.id,
    c.public_id
FROM creators c
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.id = ANY(sqlc.arg('ids')::uuid [])
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.tenant_id = c.tenant_id
            AND sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    );

-- name: ListPublishedSeriesFollowTargetPublicIDsByIDs :many
SELECT s.id,
    s.public_id
FROM series s
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = ANY(sqlc.arg('ids')::uuid [])
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW();

-- name: UserFollowsPublishedEpisode :one
-- Matches GetPublishedEpisodeByPublicIDForTenant, so a draft, scheduled, or
-- otherwise non-public episode is indistinguishable from an unfollowed one.
SELECT EXISTS (
    SELECT 1
    FROM episode_follows ef
        JOIN episodes e ON e.tenant_id = ef.tenant_id
            AND e.id = ef.episode_id
        JOIN series s ON s.tenant_id = e.tenant_id
            AND s.id = e.series_id
        JOIN episode_listings el ON el.tenant_id = e.tenant_id
            AND el.episode_id = e.id
    WHERE ef.tenant_id = sqlc.arg('tenant_id')
        AND ef.user_id = sqlc.arg('user_id')
        AND ef.episode_id = sqlc.arg('episode_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
) AS follows_published_episode;

-- name: UserFollowsPublishedCreator :one
-- Creators are public when they have at least one active series, matching
-- GetPublishedAuthorByPublicID.
SELECT EXISTS (
    SELECT 1
    FROM creator_follows cf
        JOIN creators c ON c.tenant_id = cf.tenant_id
            AND c.id = cf.creator_id
    WHERE cf.tenant_id = sqlc.arg('tenant_id')
        AND cf.user_id = sqlc.arg('user_id')
        AND cf.creator_id = sqlc.arg('creator_id')
        AND EXISTS (
            SELECT 1
            FROM series_creators sc
                JOIN series s ON s.id = sc.series_id
            WHERE sc.tenant_id = c.tenant_id
                AND sc.creator_id = c.id
                AND s.tenant_id = c.tenant_id
                AND s.is_published = true
                AND s.published_at IS NOT NULL
                AND s.published_at <= NOW()
        )
) AS follows_published_creator;

-- name: UserFollowsPublishedSeries :one
-- Matches GetPublishedSeriesByPublicIDForFollow, so an unpublished series is
-- indistinguishable from an unfollowed one.
SELECT EXISTS (
    SELECT 1
    FROM series_follows sf
        JOIN series s ON s.tenant_id = sf.tenant_id
            AND s.id = sf.series_id
    WHERE sf.tenant_id = sqlc.arg('tenant_id')
        AND sf.user_id = sqlc.arg('user_id')
        AND sf.series_id = sqlc.arg('series_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
) AS follows_published_series;
