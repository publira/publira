-- name: CreateEpisodeEyeCatchImage :one
INSERT INTO episode_eye_catch_images (
        id,
        tenant_id,
        episode_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateEpisodeEyeCatchImageVariant :one
INSERT INTO episode_eye_catch_image_variants (
        id,
        tenant_id,
        episode_eye_catch_image_id,
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

-- name: GetEpisodeEyeCatchImageVariantByTypeAndWidthForTenant :one
SELECT v.object_key,
    v.content_type
FROM episode_eye_catch_image_variants v
JOIN episode_eye_catch_images i ON i.id = v.episode_eye_catch_image_id
WHERE v.episode_eye_catch_image_id = $1
    AND i.tenant_id = $2
    AND v.variant_type = $3
    AND v.width = $4
LIMIT 1;

-- name: ListEpisodeEyeCatchVariantsByEpisodeIDs :many
-- The eye-catch of each listed episode that has one, a row per variant. It is
-- keyed by episode rather than by image so that every read holding episodes
-- can fill them with one more statement, whatever query read the episodes.
SELECT e.id AS episode_id,
    i.id AS episode_eye_catch_image_id,
    i.updated_at AS image_updated_at,
    v.id,
    v.variant_type,
    v.label,
    v.content_type,
    v.file_size_bytes,
    v.width,
    v.height
FROM episodes e
JOIN episode_eye_catch_images i ON i.id = e.eye_catch_image_id
JOIN episode_eye_catch_image_variants v ON v.episode_eye_catch_image_id = i.id
WHERE e.tenant_id = @tenant_id
    AND e.id = ANY(@episode_ids::uuid[])
ORDER BY e.id,
    v.variant_type,
    v.width;

-- name: GetEpisodeEyeCatchImageIDForTenant :one
-- The eye-catch an episode shows, read behind LockEpisodeByIDForTenant by the
-- RPCs that change it.
SELECT id,
    public_id,
    eye_catch_image_id
FROM episodes
WHERE tenant_id = $1
    AND id = $2;

-- name: SetEpisodeEyeCatchImageIDForTenant :exec
-- Points the episode at an uploaded eye-catch, or at none. The image it
-- pointed at before is left for the orphan image sweep.
UPDATE episodes
SET eye_catch_image_id = sqlc.narg('eye_catch_image_id')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: TouchEpisodeEyeCatchImage :exec
-- Records that the eye-catch changed after one of its ratios was replaced.
UPDATE episode_eye_catch_images
SET updated_at = NOW()
WHERE id = $1;

-- name: DeleteEpisodeEyeCatchImageVariantsByType :execrows
-- Clears one aspect ratio of an eye-catch.
DELETE FROM episode_eye_catch_image_variants
WHERE episode_eye_catch_image_id = $1
    AND variant_type = $2;
