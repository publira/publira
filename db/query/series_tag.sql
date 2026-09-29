-- name: ListSeriesTagsBySeriesIDs :many
-- Tags have no order of their own, so they read back by name: the same series
-- shows the same list every time, and two series sharing tags show them in the
-- same places.
SELECT st.series_id,
    t.name,
    t.slug
FROM series_tags st
    JOIN tags t ON t.id = st.tag_id
WHERE st.series_id = ANY(sqlc.arg('series_ids')::uuid[])
ORDER BY st.series_id ASC,
    t.name ASC,
    t.id ASC;

-- name: CreateSeriesTag :exec
INSERT INTO series_tags (
        tenant_id,
        series_id,
        tag_id
    )
VALUES ($1, $2, $3);

-- name: DeleteSeriesTagsBySeriesID :exec
DELETE FROM series_tags
WHERE series_id = $1;
