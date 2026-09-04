-- name: CreateEpisodeImage :one
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreateEpisodeImageVariant :one
INSERT INTO episode_image_variants (
    id,
    episode_image_id,
    label,
    storage_provider,
    object_key,
    content_type,
    file_size_bytes,
    width,
    height
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
RETURNING *;

-- name: ListEpisodeImagesByEpisodeID :many
SELECT
    ei.id,
    ei.tenant_id,
    ei.episode_id,
    ei.display_order,
    ei.created_at,
    eiv.content_type,
    eiv.file_size_bytes,
    eiv.width,
    eiv.height
FROM episode_images ei
JOIN LATERAL (
    SELECT content_type, file_size_bytes, width, height
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
WHERE ei.episode_id = $1
ORDER BY ei.display_order ASC,
    ei.created_at ASC;

-- name: ListEpisodeImagesByEpisodePublicIDForTenant :many
SELECT
    ei.id,
    ei.tenant_id,
    ei.episode_id,
    ei.display_order,
    ei.created_at,
    eiv.content_type,
    eiv.file_size_bytes,
    eiv.width,
    eiv.height
FROM episode_images ei
    JOIN episodes e ON e.id = ei.episode_id
    JOIN series s ON s.id = e.series_id
JOIN LATERAL (
    SELECT content_type, file_size_bytes, width, height
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
WHERE s.tenant_id = $1
    AND e.public_id = $2
ORDER BY ei.display_order ASC,
    ei.created_at ASC;

-- name: GetEpisodeImageAccessByIDForUser :one
SELECT ei.id,
    ei.episode_id,
    eiv.object_key,
    eiv.content_type,
    (
        s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
    ) AS is_published,
    (
        el.price = 0
        OR EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = s.tenant_id
                -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                AND p.user_id = sqlc.arg('user_id')::uuid
                AND p.episode_id = e.id
                AND (
                    p.expires_at IS NULL
                    OR p.expires_at > NOW()
                )
        )
        OR EXISTS (
            SELECT 1
            FROM access_tickets at
            WHERE at.tenant_id = s.tenant_id
                AND at.user_id = sqlc.arg('user_id')
                AND at.episode_id = e.id
                AND at.revoked_at IS NULL
                AND (
                    at.expires_at IS NULL
                    OR at.expires_at > NOW()
                )
        )
    ) AS has_access
FROM episode_images ei
JOIN LATERAL (
    SELECT object_key, content_type
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
    JOIN episodes e ON e.id = ei.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE ei.id = sqlc.arg('id')
    AND s.tenant_id = sqlc.arg('tenant_id')
LIMIT 1;

-- Tenant-staff preview: membership and role are evaluated in the handler.
-- This query only answers whether the image belongs to the tenant, with no
-- publish or price gate.
-- name: GetEpisodeImageByIDForTenant :one
SELECT ei.id,
    ei.episode_id,
    eiv.object_key,
    eiv.content_type
FROM episode_images ei
JOIN LATERAL (
    SELECT object_key, content_type
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
    JOIN episodes e ON e.id = ei.episode_id
    JOIN series s ON s.id = e.series_id
WHERE ei.id = $1
    AND s.tenant_id = $2
LIMIT 1;

-- name: GetEpisodeImagePublicAccessByIDForTenant :one
SELECT ei.id,
    ei.episode_id,
    eiv.object_key,
    eiv.content_type,
    (
        s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
    ) AS is_published,
    (el.price = 0) AS has_public_access
FROM episode_images ei
JOIN LATERAL (
    SELECT object_key, content_type
    FROM episode_image_variants
    WHERE episode_image_id = ei.id
    ORDER BY width DESC
    LIMIT 1
) eiv ON true
    JOIN episodes e ON e.id = ei.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE ei.id = $1
    AND s.tenant_id = $2
LIMIT 1;

-- name: GetMaxEpisodeImageDisplayOrderByEpisodeID :one
SELECT COALESCE(MAX(display_order), 0)::int4 AS max_display_order
FROM episode_images
WHERE episode_id = $1;

-- name: UpdateEpisodeImageDisplayOrderByIDForEpisode :exec
UPDATE episode_images
SET display_order = $3
WHERE id = $1
    AND episode_id = $2;
