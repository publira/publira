-- name: CreateCampaignBannerImage :one
INSERT INTO campaign_banner_images (
        id,
        tenant_id,
        campaign_banner_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateCampaignBannerImageVariant :one
INSERT INTO campaign_banner_image_variants (
        id,
        tenant_id,
        campaign_banner_image_id,
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

-- name: GetCampaignBannerImageVariantByTypeAndWidthForTenant :one
SELECT v.object_key,
    v.content_type
FROM campaign_banner_image_variants v
    JOIN campaign_banner_images bi ON bi.id = v.campaign_banner_image_id
WHERE v.campaign_banner_image_id = $1
    AND bi.tenant_id = $2
    AND v.variant_type = $3
    AND v.width = $4
LIMIT 1;

-- name: ListCampaignBannerImageVariantsByImageIDs :many
SELECT id,
    campaign_banner_image_id,
    variant_type,
    label,
    content_type,
    file_size_bytes,
    width,
    height
FROM campaign_banner_image_variants
WHERE campaign_banner_image_id = ANY(@image_ids::uuid[])
ORDER BY campaign_banner_image_id,
    variant_type,
    width;

-- name: TouchCampaignBannerImage :exec
-- Records that the image changed after one of its ratios was replaced.
UPDATE campaign_banner_images
SET updated_at = NOW()
WHERE id = $1;

-- name: DeleteCampaignBannerImageVariantsByType :execrows
-- Clears one aspect ratio of a banner image.
DELETE FROM campaign_banner_image_variants
WHERE campaign_banner_image_id = $1
    AND variant_type = $2;
