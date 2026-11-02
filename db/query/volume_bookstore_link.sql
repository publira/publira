-- name: ListVolumeBookstoreLinksByVolumeIDs :many
-- The bookstore links of each listed volume, in each volume's own order.
SELECT volume_id,
    label,
    url
FROM volume_bookstore_links
WHERE tenant_id = sqlc.arg('tenant_id')
    AND volume_id = ANY(sqlc.arg('volume_ids')::uuid[])
ORDER BY volume_id,
    "position";

-- name: DeleteVolumeBookstoreLinks :exec
DELETE FROM volume_bookstore_links
WHERE tenant_id = sqlc.arg('tenant_id')
    AND volume_id = sqlc.arg('volume_id');

-- name: InsertVolumeBookstoreLinks :exec
-- Writes the volume's links in the order given, the first at position 0. The
-- two arrays are read pairwise: the n-th label goes with the n-th URL.
INSERT INTO volume_bookstore_links (
        tenant_id,
        volume_id,
        "position",
        label,
        url
    )
SELECT sqlc.arg('tenant_id'),
    sqlc.arg('volume_id'),
    (l.ordinality - 1)::int4,
    l.label,
    (sqlc.arg('urls')::text[])[l.ordinality]
FROM unnest(sqlc.arg('labels')::text[]) WITH ORDINALITY AS l(label, ordinality);
