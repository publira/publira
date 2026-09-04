-- name: GetPublishedLabelByPublicID :one
-- Returns a label of the tenant. The row comes back even when the label has
-- no published series, because a label has no unpublished state of its own. A
-- label that does not exist, or one of another tenant, returns no row.
SELECT l.id,
    l.public_id,
    l.name,
    l.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at,
    (
        SELECT COUNT(*)::int4
        FROM series s
        WHERE s.label_id = l.id
            AND s.tenant_id = l.tenant_id
            AND s.is_published = true
            AND s.published_at IS NOT NULL
            AND s.published_at <= NOW()
    ) AS published_series_count
FROM labels l
    LEFT JOIN label_images li ON li.id = l.eye_catch_image_id
WHERE l.tenant_id = sqlc.arg('tenant_id')
    AND l.public_id = sqlc.arg('public_id')
LIMIT 1;

-- name: GetLabelByPublicIDForTenant :one
SELECT l.id,
    l.tenant_id,
    l.public_id,
    l.name,
    l.created_at,
    l.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at
FROM labels l
LEFT JOIN label_images li ON li.id = l.eye_catch_image_id
WHERE l.tenant_id = $1
    AND l.public_id = $2
LIMIT 1;

-- name: CreateLabelImage :one
INSERT INTO label_images (
        id,
        tenant_id,
        label_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateLabelImageVariant :one
INSERT INTO label_image_variants (
        id,
        tenant_id,
        label_image_id,
        variant_type,
        label,
        storage_provider,
        object_key,
        content_type,
        file_size_bytes,
        width,
        height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: GetLabelImageVariantByTypeAndWidthForTenant :one
SELECT liv.object_key,
    liv.content_type
FROM label_image_variants liv
JOIN label_images li ON li.id = liv.label_image_id
WHERE liv.label_image_id = $1
    AND li.tenant_id = $2
    AND liv.variant_type = $3
    AND liv.width = $4
LIMIT 1;

-- name: ListLabelImageVariantsByImageIDs :many
SELECT label_image_id,
    variant_type,
    label,
    content_type,
    file_size_bytes,
    width,
    height
FROM label_image_variants
WHERE label_image_id = ANY(@image_ids::uuid[])
ORDER BY label_image_id,
    variant_type,
    width;

-- name: LockLabelByPublicIDForTenant :one
-- Lock the label row so concurrent eye-catch writes serialize, the way
-- LockSeriesByPublicIDForTenant does for a series. The read of the row's
-- current eye_catch_image_id has to be a separate statement: READ COMMITTED
-- freezes this statement's snapshot before it waits for the lock.
SELECT id
FROM labels
WHERE tenant_id = $1
    AND public_id = $2
FOR UPDATE;

-- name: TouchLabelImage :exec
-- Records that the eye-catch changed after one of its ratios was replaced.
UPDATE label_images
SET updated_at = NOW()
WHERE id = $1;

-- name: DeleteLabelImageVariantsByType :execrows
-- Clears one aspect ratio of an eye-catch, like the series query above.
DELETE FROM label_image_variants
WHERE label_image_id = $1
    AND variant_type = $2;

-- Admin ListLabels and the public ListPublishedLabels are both
-- (created_at, id) DESC. The order and the columns are the same, so one pair
-- of queries serves both. Forward uses the DESC query; backward uses ASC so
-- the index can be scanned in reverse. The handler flips ASC rows back into
-- display order.
-- cursor rules: proto/README.md.
-- name: ListLabelsByTenantDesc :many
SELECT labels.id,
    labels.tenant_id,
    labels.public_id,
    labels.name,
    labels.created_at,
    labels.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at
FROM labels
LEFT JOIN label_images li ON li.id = labels.eye_catch_image_id
WHERE labels.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (labels.created_at, labels.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (labels.created_at, labels.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY labels.created_at DESC, labels.id DESC
LIMIT sqlc.arg('limit');

-- name: ListLabelsByTenantAsc :many
SELECT labels.id,
    labels.tenant_id,
    labels.public_id,
    labels.name,
    labels.created_at,
    labels.eye_catch_image_id,
    li.updated_at AS eye_catch_image_updated_at
FROM labels
LEFT JOIN label_images li ON li.id = labels.eye_catch_image_id
WHERE labels.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (labels.created_at, labels.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (labels.created_at, labels.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY labels.created_at ASC, labels.id ASC
LIMIT sqlc.arg('limit');

-- name: CreateLabel :one
INSERT INTO labels (
        id,
        tenant_id,
        public_id,
        name,
        eye_catch_image_id
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateLabel :exec
UPDATE labels
SET name = $2,
    eye_catch_image_id = $3
WHERE id = $1;
