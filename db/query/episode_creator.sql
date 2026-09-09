-- name: ListEpisodeCreatorsByEpisodeIDs :many
-- Credits are presented in role priority first, so the leading role opens the
-- list on every episode without anyone ordering it by hand. display_order
-- sorts the creators who share a role, and the name settles a tie between two
-- roles that carry the same priority.
--
-- The join to the role is outer: a credit baked from one written before roles
-- existed states none, and it is still a credit. Those come last, which is
-- where a name with nothing said about it belongs.
SELECT ec.episode_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    cr.public_id AS role_public_id,
    cr.name AS role_name,
    ec.display_order,
    ec.source
FROM episode_creators ec
    JOIN creators c ON c.id = ec.creator_id
    LEFT JOIN creator_roles cr ON cr.id = ec.role_id
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
WHERE ec.episode_id = ANY(sqlc.arg('episode_ids')::uuid[])
ORDER BY ec.episode_id ASC,
    cr.display_priority ASC NULLS LAST,
    ec.display_order ASC,
    c.name ASC;

-- name: CreateEpisodeCreator :exec
-- role_id is cast to a plain uuid rather than left nullable like the column:
-- the column admits NULL for the credits baked from ones that predate roles,
-- and a credit written through here always names one.
INSERT INTO episode_creators (
        tenant_id,
        episode_id,
        creator_id,
        role_id,
        display_order,
        source
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('episode_id'),
        sqlc.arg('creator_id'),
        sqlc.arg('role_id')::uuid,
        sqlc.arg('display_order'),
        sqlc.arg('source')
    );

-- name: DeleteEpisodeCreatorsByEpisodeID :exec
DELETE FROM episode_creators
WHERE episode_id = $1;

-- name: BakeSeriesCreatorsOntoEpisode :exec
-- The copy that makes the episode the unit that is credited. It runs in the
-- transaction that creates the episode, so an episode never exists without the
-- team its series had at that moment, and a later edit of the series leaves it
-- as it is.
--
-- The columns are listed one for one against series_creators rather than
-- selected with a star, so a column added to both tables — a share of the
-- revenue, say — is one line here.
INSERT INTO episode_creators (
        tenant_id,
        episode_id,
        creator_id,
        role_id,
        display_order,
        source
    )
SELECT sc.tenant_id,
    sqlc.arg('episode_id'),
    sc.creator_id,
    sc.role_id,
    sc.display_order,
    'series'
FROM series_creators sc
WHERE sc.tenant_id = sqlc.arg('tenant_id')
    AND sc.series_id = sqlc.arg('series_id');

-- name: CountEpisodeCreatorsByRoleIDForTenant :one
-- Whether a role may still be deleted, counted over the episodes. The refusal
-- is the handler's, and this is one half of what it is based on.
SELECT COUNT(*)::int4 AS credit_count
FROM episode_creators
WHERE tenant_id = sqlc.arg('tenant_id')
    AND role_id = sqlc.arg('role_id')::uuid;
