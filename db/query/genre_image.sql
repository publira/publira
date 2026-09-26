-- name: CreateGenreImage :one
INSERT INTO genre_images (
        id,
        tenant_id,
        genre_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateGenreImageVariant :one
INSERT INTO genre_image_variants (
        id,
        tenant_id,
        genre_image_id,
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

-- name: GetGenreImageVariantByTypeAndWidthForTenant :one
SELECT giv.object_key,
    giv.content_type
FROM genre_image_variants giv
JOIN genre_images gi ON gi.id = giv.genre_image_id
WHERE giv.genre_image_id = $1
    AND gi.tenant_id = $2
    AND giv.variant_type = $3
    AND giv.width = $4
LIMIT 1;

-- name: ListGenreImageVariantsByImageIDs :many
SELECT genre_image_id,
    variant_type,
    label,
    content_type,
    file_size_bytes,
    width,
    height
FROM genre_image_variants
WHERE genre_image_id = ANY(@image_ids::uuid[])
ORDER BY genre_image_id,
    variant_type,
    width;

-- name: LockGenreByPublicIDForTenant :one
-- Serializes eye-catch writes on one genre, as LockLabelByPublicIDForTenant
-- does for a label; the caller re-reads eye_catch_image_id behind it.
SELECT id
FROM genres
WHERE tenant_id = $1
    AND public_id = $2
FOR UPDATE;

-- name: TouchGenreImage :exec
-- Records that the eye-catch changed after one of its ratios was replaced.
UPDATE genre_images
SET updated_at = NOW()
WHERE id = $1;

-- name: DeleteGenreImageVariantsByType :execrows
-- Clears one aspect ratio of an eye-catch.
DELETE FROM genre_image_variants
WHERE genre_image_id = $1
    AND variant_type = $2;
