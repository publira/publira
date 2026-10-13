-- name: CreateUserImage :one
INSERT INTO user_images (
        id,
        tenant_id,
        user_id,
        updated_at
    )
VALUES ($1, $2, $3, NOW())
RETURNING *;

-- name: CreateUserImageVariant :one
INSERT INTO user_image_variants (
        id,
        tenant_id,
        user_image_id,
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

-- name: SetUserIconImage :execrows
-- Elects an account's icon, or clears it when icon_image_id is NULL. The image
-- it replaces is left for the orphan sweep rather than deleted here, so two
-- uploads racing for the same account need no lock between them: whichever
-- loses is only one more image nothing elects.
UPDATE users
SET icon_image_id = sqlc.narg(icon_image_id)
WHERE tenant_id = @tenant_id
    AND id = @id;

-- name: GetUserIconImageByIDForTenant :one
-- The stored object behind an account's icon, and only while the account
-- elects it. A reader who replaces or removes an icon expects it to stop being
-- shown, so a superseded image is not served in the time before the orphan
-- sweep reclaims it.
SELECT uiv.object_key,
    uiv.content_type
FROM user_images ui
JOIN users u ON u.tenant_id = ui.tenant_id
    AND u.icon_image_id = ui.id
JOIN LATERAL (
    SELECT object_key, content_type
    FROM user_image_variants
    WHERE user_image_id = ui.id
    ORDER BY width DESC
    LIMIT 1
) uiv ON true
WHERE ui.id = $1
    AND ui.tenant_id = $2
LIMIT 1;
