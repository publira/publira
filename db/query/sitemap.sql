-- The sitemap reads sitemap_entries, which states what a sitemap holds. The
-- list is sorted by (kind, id): kind is the SitemapEntryKind number, and id the
-- UUIDv7 of the row, which is unique within a kind. Backward calls the
-- descending query, and the caller sorts the rows back.
-- cursor rules: proto/README.md.
-- name: ListSitemapEntriesAsc :many
SELECT kind::int4 AS kind,
    id,
    public_id,
    series_public_id,
    slug,
    last_modified_at
FROM sitemap_entries
WHERE tenant_id = sqlc.arg('tenant_id')
    AND surface = sqlc.arg('surface')::text
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (kind, id) >= (
                sqlc.narg('cursor_kind')::int4,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (kind, id) > (
                sqlc.narg('cursor_kind')::int4,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY kind ASC,
    id ASC
LIMIT sqlc.arg('limit');

-- name: ListSitemapEntriesDesc :many
-- The backward direction of ListSitemapEntriesAsc.
SELECT kind::int4 AS kind,
    id,
    public_id,
    series_public_id,
    slug,
    last_modified_at
FROM sitemap_entries
WHERE tenant_id = sqlc.arg('tenant_id')
    AND surface = sqlc.arg('surface')::text
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (kind, id) <= (
                sqlc.narg('cursor_kind')::int4,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (kind, id) < (
                sqlc.narg('cursor_kind')::int4,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY kind DESC,
    id DESC
LIMIT sqlc.arg('limit');
