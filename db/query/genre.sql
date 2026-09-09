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

-- The public genre list: the tenant's whole genre list, in the order the
-- console put it in, each genre carrying how many of its series are published
-- right now. A genre no published series carries stays in the list, for the
-- reason a label with no published series does — the URL of its page has to
-- keep working after its last series is taken down.
--
-- The count is a sub-select rather than a join so it cannot multiply the
-- genre rows, and it walks idx_series_genres_tenant_genre from the genre into
-- the series it names.
--
-- The cursor is the same (display_order, id) pair the console list pages on;
-- forward uses the ascending query and backward the descending one, and the
-- handler flips those rows back into display order.
-- cursor rules: proto/README.md.
-- name: ListPublishedGenresByTenantAsc :many
SELECT g.id,
    g.public_id,
    g.name,
    g.slug,
    g.display_order,
    (
        SELECT COUNT(*)
        FROM series_genres sg
            JOIN series s ON s.id = sg.series_id
        WHERE sg.genre_id = g.id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )::int4 AS published_series_count
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

-- name: ListPublishedGenresByTenantDesc :many
SELECT g.id,
    g.public_id,
    g.name,
    g.slug,
    g.display_order,
    (
        SELECT COUNT(*)
        FROM series_genres sg
            JOIN series s ON s.id = sg.series_id
        WHERE sg.genre_id = g.id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )::int4 AS published_series_count
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

-- name: GetGenreIDByPublicIDForTenant :one
-- Whether a public ID the series list was filtered by names a genre of this
-- tenant. A filter naming nothing is refused rather than answered with an
-- empty list, so a storefront cannot show an empty page for a genre that was
-- deleted or belongs to somebody else.
SELECT g.id
FROM genres g
WHERE g.tenant_id = $1
    AND g.public_id = $2
LIMIT 1;
