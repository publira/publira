-- name: ListSeriesCreatorsBySeriesIDs :many
-- Credits are presented in role priority first, so the leading role opens the
-- list on every series without anyone ordering it by hand. display_order sorts
-- the creators who share a role, and the name settles a tie between two roles
-- that carry the same priority.
--
-- The join to the role is outer: a credit written before roles existed states
-- none, and it is still a credit. Those come last, which is where a name with
-- nothing said about it belongs.
SELECT sc.series_id,
    c.public_id,
    c.name,
    cr.public_id AS role_public_id,
    cr.name AS role_name,
    sc.display_order
FROM series_creators sc
    JOIN creators c ON c.id = sc.creator_id
    LEFT JOIN creator_roles cr ON cr.id = sc.role_id
WHERE sc.series_id = ANY(sqlc.arg('series_ids')::uuid[])
ORDER BY sc.series_id ASC,
    cr.display_priority ASC NULLS LAST,
    sc.display_order ASC,
    c.name ASC;

-- name: CreateSeriesCreator :exec
-- role_id is cast to a plain uuid rather than left nullable like the column:
-- the column admits NULL for the credits that predate roles, and a credit
-- written through here always names one.
INSERT INTO series_creators (
        tenant_id,
        series_id,
        creator_id,
        role_id,
        display_order
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('series_id'),
        sqlc.arg('creator_id'),
        sqlc.arg('role_id')::uuid,
        sqlc.arg('display_order')
    );

-- name: DeleteSeriesCreatorsBySeriesID :exec
DELETE FROM series_creators
WHERE series_id = $1;
