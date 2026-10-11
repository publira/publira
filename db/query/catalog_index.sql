-- What the OpenSearch catalog index is written from: the outbox handler reads
-- one row, and the reindex every row of a tenant. Both run in one REPEATABLE
-- READ transaction and read GetCatalogIndexSnapshotTime first, because that
-- instant is the version each document is written with.
--
-- A row that comes back with no surfaces is not searchable, and a tombstone
-- is written in place of its document; its published_at is then the epoch,
-- which nothing reads. A creator or a label is published through its series, so it
-- carries every surface one of its published series is on, from the earliest
-- of their published_at. A published_at still in the future is written as it
-- is, and the search filters on it.
--
-- A series also carries what the published series list narrows and sorts by,
-- so a search can do the same. Two of those facts move with the clock rather
-- than with an edit — whether a free episode is open, and when the latest
-- episode was published — and are read at the start of the transaction, the
-- instant the document's version names. The ticker jobs queue an event for a
-- series whenever one of its free windows opens or closes and whenever one of
-- its scheduled episodes is published, so the document is read again once the
-- boundary has passed.

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
    )::text [] AS surfaces,
    COALESCE(sl.status, '')::text AS status,
    COALESCE(sl.schedule_weekdays, '{}')::int4 [] AS schedule_weekdays,
    ARRAY(
        SELECT g.public_id
        FROM series_genres sg
            JOIN genres g ON g.id = sg.genre_id
        WHERE sg.series_id = s.id
        ORDER BY g.public_id
    )::text [] AS genre_public_ids,
    ARRAY(
        SELECT t.slug
        FROM series_tags st
            JOIN tags t ON t.id = st.tag_id
        WHERE st.series_id = s.id
        ORDER BY t.slug
    )::text [] AS tag_slugs,
    -- The surfaces on which a free episode of the series is open, which is
    -- what the list's has_free_episodes filter asks of the surface it runs on.
    ARRAY(
        SELECT DISTINCT es.surface
        FROM published_free_episodes fe
            JOIN episode_surfaces es ON es.episode_id = fe.episode_id
        WHERE fe.series_id = s.id
        ORDER BY es.surface
    )::text [] AS free_episode_surfaces,
    -- The list's latest_episode_at on each surface the series is shown on: the
    -- newest episode published there, or the series' own published_at where
    -- none is.
    --
    -- The episodes are read from episode_surfaces and their listing rather
    -- than from published_episode_surfaces, which would also require the
    -- series' published_at to have passed. A series is indexed ahead of that
    -- instant and the search filters on it, while nothing reads the document
    -- again when the instant passes: gated on it, a series scheduled with its
    -- episodes already out would be sorted by its own published_at for good.
    -- Whether the series is published at all is checked by the outer
    -- subquery, as it is for surfaces.
    COALESCE(
        (
            SELECT jsonb_object_agg(
                    ss.surface,
                    COALESCE(
                        (
                            SELECT max(el.published_at)
                            FROM episodes e
                                JOIN episode_listings el ON el.episode_id = e.id
                                JOIN episode_surfaces es ON es.episode_id = e.id
                            WHERE e.series_id = s.id
                                AND es.surface = ss.surface
                                AND el.status = 'published'
                                AND el.published_at IS NOT NULL
                                AND el.published_at <= NOW()
                        ),
                        s.published_at
                    )
                )
            FROM series_surfaces ss
            WHERE ss.series_id = s.id
                AND s.is_published = true
                AND s.published_at IS NOT NULL
        ),
        '{}'
    )::jsonb AS latest_episode_at_by_surface
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
