-- name: CreateVolumeCoverImage :one
INSERT INTO volume_cover_images (
        id,
        tenant_id,
        volume_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateVolumeCoverImageVariant :one
INSERT INTO volume_cover_image_variants (
        id,
        tenant_id,
        volume_cover_image_id,
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

-- name: GetVolumeCoverImageVariantByTypeAndWidthForTenant :one
SELECT v.object_key,
    v.content_type
FROM volume_cover_image_variants v
    JOIN volume_cover_images vi ON vi.id = v.volume_cover_image_id
WHERE v.volume_cover_image_id = $1
    AND vi.tenant_id = $2
    AND v.variant_type = $3
    AND v.width = $4
LIMIT 1;

-- name: ListVolumeCoverImageVariantsByImageIDs :many
SELECT id,
    volume_cover_image_id,
    variant_type,
    label,
    content_type,
    file_size_bytes,
    width,
    height
FROM volume_cover_image_variants
WHERE tenant_id = @tenant_id
    AND volume_cover_image_id = ANY(@image_ids::uuid[])
ORDER BY volume_cover_image_id,
    variant_type,
    width;
