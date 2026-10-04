-- What the OpenSearch catalog index is written from: the outbox handler reads
-- one row, and the reindex every row of a tenant. Both run in one REPEATABLE
-- READ transaction and read GetCatalogIndexSnapshotTime first, because that
-- instant is the version each document is written with.
--
-- A row that comes back with no surfaces is not searchable, and its document
-- is deleted rather than written; its published_at is then the epoch, which
-- nothing reads. A creator or a label is published through its series, so it
-- carries every surface one of its published series is on, from the earliest
-- of their published_at. A published_at still in the future is written as it
-- is, and the search filters on it.

-- name: GetCatalogIndexSnapshotTime :one
-- The start of the transaction, which precedes its snapshot: every write the
-- snapshot misses commits after this instant, and the outbox event that write
-- queued is read later still, under a higher version.
SELECT transaction_timestamp()::timestamptz AS snapshot_at;

-- name: ListCatalogIndexTenantIDs :many
SELECT id
FROM tenants
ORDER BY id;

-- name: ListCatalogIndexSeries :many
-- Every series of the tenant, or the one series_id names.
SELECT s.id,
    s.title,
    COALESCE(sl.synopsis, '')::text AS synopsis,
    COALESCE(s.published_at, 'epoch')::timestamptz AS published_at,
    ARRAY(
        SELECT ss.surface
        FROM series_surfaces ss
        WHERE ss.series_id = s.id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
        ORDER BY ss.surface
    )::text [] AS surfaces
FROM series s
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('series_id')::uuid IS NULL
        OR s.id = sqlc.narg('series_id')::uuid
    )
ORDER BY s.id;

-- name: ListCatalogIndexCreators :many
-- Every creator of the tenant, or the one creator_id names, with what the
-- series that credit it publish.
SELECT c.id,
    c.name,
    COALESCE(p.published_at, 'epoch')::timestamptz AS published_at,
    COALESCE(p.surfaces, '{}')::text [] AS surfaces
FROM creators c
    LEFT JOIN LATERAL (
        SELECT min(s.published_at) AS published_at,
            array_agg(
                DISTINCT ss.surface
                ORDER BY ss.surface
            ) AS surfaces
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
            JOIN series_surfaces ss ON ss.series_id = s.id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
    ) p ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('creator_id')::uuid IS NULL
        OR c.id = sqlc.narg('creator_id')::uuid
    )
ORDER BY c.id;

-- name: ListCatalogIndexLabels :many
-- Every label of the tenant, or the one label_id names, with what the series
-- under it publish.
SELECT l.id,
    l.name,
    COALESCE(p.published_at, 'epoch')::timestamptz AS published_at,
    COALESCE(p.surfaces, '{}')::text [] AS surfaces
FROM labels l
    LEFT JOIN LATERAL (
        SELECT min(s.published_at) AS published_at,
            array_agg(
                DISTINCT ss.surface
                ORDER BY ss.surface
            ) AS surfaces
        FROM series s
            JOIN series_surfaces ss ON ss.series_id = s.id
        WHERE s.label_id = l.id
            AND s.tenant_id = l.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
    ) p ON true
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('label_id')::uuid IS NULL
        OR l.id = sqlc.narg('label_id')::uuid
    )
ORDER BY l.id;
