-- name: ListSeriesCreatorsBySeriesIDs :many
SELECT sc.series_id,
    c.public_id,
    c.name,
    sc.role,
    sc.display_order
FROM series_creators sc
    JOIN creators c ON c.id = sc.creator_id
WHERE sc.series_id = ANY(sqlc.arg('series_ids')::uuid[])
ORDER BY sc.series_id ASC,
    sc.display_order ASC,
    c.created_at ASC;

-- name: CreateSeriesCreator :exec
INSERT INTO series_creators (
    tenant_id,
        series_id,
        creator_id,
        role,
        display_order
    )
VALUES ($1, $2, $3, $4, $5);

-- name: DeleteSeriesCreatorsBySeriesID :exec
DELETE FROM series_creators
WHERE series_id = $1;
