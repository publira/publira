-- Durable member follows (#1128). Episode and creator follows have distinct
-- source tables; content_events must not be used to model either relation.

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

-- name: ListUserFollowsByCreatedAtDesc :many
-- The API can expose one timeline while keeping each relationship's storage
-- and future aggregates independent. The full sort key is stable for cursors.
SELECT target_type,
    target_id,
    created_at
FROM (
    SELECT 'episode'::text AS target_type,
        episode_id AS target_id,
        created_at
    FROM episode_follows ef
    WHERE ef.tenant_id = sqlc.arg('tenant_id')
        AND ef.user_id = sqlc.arg('user_id')
    UNION ALL
    SELECT 'creator'::text AS target_type,
        creator_id AS target_id,
        created_at
    FROM creator_follows cf
    WHERE cf.tenant_id = sqlc.arg('tenant_id')
        AND cf.user_id = sqlc.arg('user_id')
) follows
ORDER BY created_at DESC,
    target_type ASC,
    target_id ASC
LIMIT sqlc.arg('limit');

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
