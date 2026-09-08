-- The genre list is read in the order the tenant put it in, so the cursor
-- sorts on (display_order, id) — the same pair idx_genres_tenant_display_order
-- holds. Forward uses the ascending query; backward uses the descending one so
-- the index is scanned in reverse, and the handler flips those rows back into
-- display order.
-- cursor rules: proto/README.md.
-- name: ListGenresByTenantAsc :many
SELECT g.id,
    g.public_id,
    g.name,
    g.slug,
    g.display_order,
    g.created_at
FROM genres g
WHERE g.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (g.display_order, g.id) >= (sqlc.narg('cursor_display_order')::int4, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (g.display_order, g.id) > (sqlc.narg('cursor_display_order')::int4, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY g.display_order ASC,
    g.id ASC
LIMIT sqlc.arg('limit');

-- name: ListGenresByTenantDesc :many
SELECT g.id,
    g.public_id,
    g.name,
    g.slug,
    g.display_order,
    g.created_at
FROM genres g
WHERE g.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (g.display_order, g.id) <= (sqlc.narg('cursor_display_order')::int4, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (g.display_order, g.id) < (sqlc.narg('cursor_display_order')::int4, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY g.display_order DESC,
    g.id DESC
LIMIT sqlc.arg('limit');

-- name: GetGenreByPublicIDForTenant :one
SELECT g.id,
    g.public_id,
    g.name,
    g.slug,
    g.display_order,
    g.created_at
FROM genres g
WHERE g.tenant_id = $1
    AND g.public_id = $2
LIMIT 1;

-- name: ListGenresByPublicIDsForTenant :many
-- Resolves the genres a series form assigned. The caller compares the row
-- count against what it asked for, so a public_id of another tenant reads as
-- a genre that does not exist.
SELECT g.id,
    g.public_id,
    g.name,
    g.slug,
    g.display_order
FROM genres g
WHERE g.tenant_id = sqlc.arg('tenant_id')
    AND g.public_id = ANY(sqlc.arg('public_ids')::text[])
ORDER BY g.display_order ASC,
    g.id ASC;

-- name: LockGenresForTenant :many
-- Locks every genre of the tenant and hands back the order they are in now, so
-- a reorder can check the client's expected order against a list no concurrent
-- write can move underneath it. The names come along because a reorder answers
-- with the whole list, and nothing in this transaction changes them.
SELECT id,
    public_id,
    name,
    slug
FROM genres
WHERE tenant_id = $1
ORDER BY display_order ASC,
    id ASC
FOR UPDATE;

-- name: GetMaxGenreDisplayOrderForTenant :one
-- Where a newly created genre goes: after everything that already exists.
SELECT COALESCE(MAX(display_order), 0)::int4 AS max_display_order
FROM genres
WHERE tenant_id = $1;

-- name: CountSeriesByGenreIDForTenant :one
-- Whether a genre may still be deleted. The refusal is the handler's, and this
-- is what it is based on.
SELECT COUNT(*)::int4 AS series_count
FROM series_genres
WHERE tenant_id = $1
    AND genre_id = $2;

-- name: CreateGenre :one
INSERT INTO genres (
        id,
        tenant_id,
        public_id,
        name,
        slug,
        display_order
    )
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: UpdateGenre :exec
UPDATE genres
SET name = $2,
    slug = $3
WHERE id = $1;

-- name: UpdateGenreDisplayOrder :exec
UPDATE genres
SET display_order = $2
WHERE id = $1;

-- name: DeleteGenre :exec
DELETE FROM genres
WHERE id = $1;
