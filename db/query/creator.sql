-- The cursor pagination of the published author list runs in two stages.
--
-- Stage one is ListPublishedAuthorIDsByName*, which settles nothing but the
-- ids of the creators that hold at least one published series. The sort key
-- is (name, id); id is a UUIDv7, so the order stays unique even when two
-- creators share a name.
--
-- web-host used to order the names with localeCompare(..., "ja"), but the ICU
-- ja collation compares differently unless every environment carries the same
-- locale data, which changes the cursor comparison and breaks the btree
-- keyset scan. name is therefore compared in the database's default
-- collation. Adding ja-x-icu later means rebuilding the index in that
-- collation and moving the cursor comparison to it as well.
--
-- The EXISTS published predicate is the one
-- ListActiveSeriesIDsByPublishedAtDesc uses. Once the two drift apart, the
-- series list and the author page disagree about which works are visible.
-- Every direction gets its own query with a fixed ORDER BY, because branching
-- with CASE stops idx_creators_tenant_name from being read in index order.
-- Backward calls the DESC query, and the caller sorts the rows back.
--
-- Stage two is ListPublishedAuthorsByIDs, which builds the display data and
-- the published series count for the ids stage one settled on.
-- name: ListPublishedAuthorIDsByNameAsc :many
SELECT c.id
FROM creators c
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) >= (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) > (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.name ASC,
    c.id ASC
LIMIT sqlc.arg('limit');

-- name: ListPublishedAuthorIDsByNameDesc :many
SELECT c.id
FROM creators c
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) <= (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.name, c.id) < (
                sqlc.narg('cursor_name')::text,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.name DESC,
    c.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPublishedAuthorsByIDs :many
-- No ORDER BY: the caller sorts the rows into the id order stage one settled
-- on.
SELECT c.id,
    c.public_id,
    c.name,
    c.profile_text,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    (
        SELECT COUNT(*)::int4
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    ) AS published_series_count
FROM creators c
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM creator_image_variants
        WHERE creator_image_id = ci.id
        ORDER BY width DESC
        LIMIT 1
    ) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.id = ANY(sqlc.arg('ids')::uuid []);

-- name: GetPublishedAuthorByPublicID :one
-- Returns only the creators that hold at least one published series. The
-- caller turns an empty result into not_found exactly as it does a missing
-- row, so the existence of an unpublished author does not leak.
SELECT c.id,
    c.public_id,
    c.name,
    c.profile_text,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    (
        SELECT COUNT(*)::int4
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    ) AS published_series_count
FROM creators c
    LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
    LEFT JOIN LATERAL (
        SELECT file_size_bytes
        FROM creator_image_variants
        WHERE creator_image_id = ci.id
        ORDER BY width DESC
        LIMIT 1
    ) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.public_id = sqlc.arg('public_id')
    AND EXISTS (
        SELECT 1
        FROM series_creators sc
            JOIN series s ON s.id = sc.series_id
        WHERE sc.creator_id = c.id
            AND s.tenant_id = c.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    )
LIMIT 1;

-- name: ListCreatorsByPublicIDsForTenant :many
SELECT id,
    tenant_id,
    public_id,
    name,
    profile_text,
    created_at
FROM creators
WHERE tenant_id = $1
    AND public_id = ANY(sqlc.arg('public_ids')::varchar[]);

-- Admin ListCreators is (created_at, id) DESC. Forward uses the DESC query;
-- backward uses ASC so the index can be scanned in reverse. The handler
-- flips ASC rows back into display order.
-- cursor rules: proto/README.md.
-- name: ListCreatorsByTenantDesc :many
SELECT c.id,
    c.tenant_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.created_at,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    COALESCE(civ.width, 0)::int4 AS icon_image_width,
    COALESCE(civ.height, 0)::int4 AS icon_image_height
FROM creators c
LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
LEFT JOIN LATERAL (
    SELECT file_size_bytes, width, height
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY c.created_at DESC, c.id DESC
LIMIT sqlc.arg('limit');

-- name: ListCreatorsByTenantAsc :many
SELECT c.id,
    c.tenant_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.created_at,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    COALESCE(civ.width, 0)::int4 AS icon_image_width,
    COALESCE(civ.height, 0)::int4 AS icon_image_height
FROM creators c
LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
LEFT JOIN LATERAL (
    SELECT file_size_bytes, width, height
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY c.created_at ASC, c.id ASC
LIMIT sqlc.arg('limit');

-- name: CreateCreator :one
INSERT INTO creators (
        id,
        tenant_id,
        public_id,
        name,
        profile_text,
        icon_image_id
    )
VALUES ($1, $2, $3, $4, $5, $6)
RETURNING *;

-- name: CreateCreatorImage :one
INSERT INTO creator_images (
        id,
        tenant_id,
        creator_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateCreatorImageVariant :one
INSERT INTO creator_image_variants (
        id,
        tenant_id,
        creator_image_id,
        label,
        storage_provider,
        object_key,
        content_type,
        file_size_bytes,
        width,
        height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
RETURNING *;

-- name: GetCreatorByPublicIDForTenant :one
SELECT c.id,
    c.tenant_id,
    c.public_id,
    c.name,
    c.profile_text,
    c.created_at,
    c.icon_image_id,
    ci.updated_at AS icon_image_updated_at,
    COALESCE(civ.file_size_bytes, 0)::bigint AS icon_image_file_size_bytes,
    COALESCE(civ.width, 0)::int4 AS icon_image_width,
    COALESCE(civ.height, 0)::int4 AS icon_image_height
FROM creators c
LEFT JOIN creator_images ci ON ci.id = c.icon_image_id
LEFT JOIN LATERAL (
    SELECT file_size_bytes, width, height
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE c.tenant_id = $1
    AND c.public_id = $2
LIMIT 1;

-- name: UpdateCreator :exec
UPDATE creators
SET name = $2,
    profile_text = $3,
    icon_image_id = $4
WHERE id = $1;

-- name: GetCreatorImageByIDForTenant :one
SELECT civ.object_key,
    civ.content_type
FROM creator_images ci
JOIN LATERAL (
    SELECT object_key, content_type
    FROM creator_image_variants
    WHERE creator_image_id = ci.id
    ORDER BY width DESC
    LIMIT 1
) civ ON true
WHERE ci.id = $1
    AND ci.tenant_id = $2
LIMIT 1;
