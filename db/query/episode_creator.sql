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

-- name: BulkAddEpisodeCreator :many
-- Credits one person, in one role, on every episode of the range that does not
-- carry that pair already. The source is `series` because a range edit is how
-- the standing team is corrected: the row it writes is the one a later range
-- edit has to be able to move again.
--
-- display_order puts the new credit after what the episode already carries,
-- which is where a name added to a role belongs; the read sorts by role
-- priority first, so it only decides the order inside that role.
--
-- ON CONFLICT DO NOTHING makes an episode that already has the credit a row
-- the RETURNING does not name, which is how the handler tells the two apart in
-- one statement.
INSERT INTO episode_creators (
        tenant_id,
        episode_id,
        creator_id,
        role_id,
        display_order,
        source
    )
SELECT sqlc.arg('tenant_id'),
    target.episode_id,
    sqlc.arg('creator_id')::uuid,
    sqlc.arg('role_id')::uuid,
    COALESCE(
        (
            SELECT MAX(ec.display_order) + 1
            FROM episode_creators ec
            WHERE ec.episode_id = target.episode_id
        ),
        0
    ),
    'series'
FROM unnest(sqlc.arg('episode_ids')::uuid[]) AS target(episode_id)
ON CONFLICT (episode_id, creator_id, role_id) DO NOTHING
RETURNING episode_id;

-- name: BulkReplaceEpisodeCreator :many
-- Rewrites one credit into another across the range. `source = 'series'` is
-- what keeps a guest credited on one episode of the range where they were: the
-- range edit moves the standing team and nothing else.
UPDATE episode_creators
SET creator_id = sqlc.arg('new_creator_id')::uuid,
    role_id = sqlc.arg('new_role_id')::uuid
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = ANY(sqlc.arg('episode_ids')::uuid[])
    AND creator_id = sqlc.arg('creator_id')::uuid
    AND role_id = sqlc.arg('role_id')::uuid
    AND source = 'series'
RETURNING episode_id;

-- name: BulkRemoveEpisodeCreator :many
DELETE FROM episode_creators
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = ANY(sqlc.arg('episode_ids')::uuid[])
    AND creator_id = sqlc.arg('creator_id')::uuid
    AND role_id = sqlc.arg('role_id')::uuid
    AND source = 'series'
RETURNING episode_id;

-- name: ListEpisodesCreditedOnTheEpisodeItself :many
-- The episodes of the range that hold the named credit as their own rather
-- than as the series'. They are the ones a replace or a remove passes over,
-- and this is what lets the response say so instead of reporting them beside
-- the episodes that never held the credit at all.
SELECT DISTINCT episode_id
FROM episode_creators
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = ANY(sqlc.arg('episode_ids')::uuid[])
    AND creator_id = sqlc.arg('creator_id')::uuid
    AND role_id = sqlc.arg('role_id')::uuid
    AND source = 'episode';

-- name: ListEpisodesHoldingBothEpisodeCredits :many
-- The episodes a replace would leave crediting the same person twice in the
-- same role: they carry the credit being replaced as the series', and already
-- carry the one it would become. The unique constraint would refuse the whole
-- statement, so the handler refuses first and names them.
SELECT DISTINCT replaced.episode_id
FROM episode_creators replaced
WHERE replaced.tenant_id = sqlc.arg('tenant_id')
    AND replaced.episode_id = ANY(sqlc.arg('episode_ids')::uuid[])
    AND replaced.creator_id = sqlc.arg('creator_id')::uuid
    AND replaced.role_id = sqlc.arg('role_id')::uuid
    AND replaced.source = 'series'
    AND EXISTS (
        SELECT 1
        FROM episode_creators existing
        WHERE existing.episode_id = replaced.episode_id
            AND existing.creator_id = sqlc.arg('new_creator_id')::uuid
            AND existing.role_id = sqlc.arg('new_role_id')::uuid
    );
