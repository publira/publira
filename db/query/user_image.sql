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

-- name: ListUserIconImageVariantsByImageIDs :many
-- The stored variants of the given icon images, with the time each image was
-- stored. A caller reads the ids off the accounts it is answering for, so one
-- query covers a whole page of them; an id the tenant does not hold answers no
-- rows.
--
-- An image no account elects any longer answers no rows either. The ids were
-- read by an earlier statement, and an icon replaced since then is one
-- image-server already refuses, so its URL would be a broken image in an
-- answer the storefront may cache after the replacement's drop has passed.
SELECT ui.id AS user_image_id,
    ui.updated_at,
    uiv.label,
    uiv.content_type,
    uiv.width,
    uiv.height,
    uiv.file_size_bytes
FROM user_images ui
    JOIN users u ON u.tenant_id = ui.tenant_id
        AND u.icon_image_id = ui.id
    JOIN user_image_variants uiv ON uiv.tenant_id = ui.tenant_id
        AND uiv.user_image_id = ui.id
WHERE ui.tenant_id = sqlc.arg('tenant_id')
    AND ui.id = ANY(sqlc.arg('image_ids')::uuid[])
ORDER BY ui.id,
    uiv.width DESC,
    uiv.label;
