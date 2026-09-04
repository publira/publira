-- name: CreateSeriesImage :one
INSERT INTO series_images (
        id,
        tenant_id,
        series_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateSeriesImageVariant :one
INSERT INTO series_image_variants (
        id,
        tenant_id,
        series_image_id,
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

-- name: GetSeriesImageVariantByTypeAndWidthForTenant :one
SELECT siv.object_key,
    siv.content_type
FROM series_image_variants siv
JOIN series_images si ON si.id = siv.series_image_id
WHERE siv.series_image_id = $1
    AND si.tenant_id = $2
    AND siv.variant_type = $3
    AND siv.width = $4
LIMIT 1;

-- name: ListSeriesImageVariantsByImageIDs :many
SELECT series_image_id,
    variant_type,
    label,
    content_type,
    file_size_bytes,
    width,
    height
FROM series_image_variants
WHERE series_image_id = ANY(@image_ids::uuid[])
ORDER BY series_image_id,
    variant_type,
    width;

-- name: TouchSeriesImage :exec
-- Records that the eye-catch changed after one of its ratios was replaced.
-- `updated_at` is what the console reads back and what busts the cached URL.
UPDATE series_images
SET updated_at = NOW()
WHERE id = $1;

-- name: DeleteSeriesImageVariantsByType :execrows
-- Clears one aspect ratio of an eye-catch so a newly uploaded image for that
-- ratio can take its place. The objects the deleted rows named are left to
-- `batch purge-orphan-images`.
DELETE FROM series_image_variants
WHERE series_image_id = $1
    AND variant_type = $2;

-- name: UpdateSeriesEyeCatchImageID :exec
UPDATE series
SET eye_catch_image_id = $2,
    updated_at = NOW()
WHERE id = $1;
