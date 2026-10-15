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
-- loses is only one more image nothing elects. An account shows one icon, so
-- either way the preset it elected is cleared too.
UPDATE users
SET icon_image_id = sqlc.narg(icon_image_id),
    icon_preset_id = NULL
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

-- name: ListUserIconVariantsByUserIDs :many
-- The stored variants of the icon each of the given accounts elects now, with
-- the time it was stored. An account's icon is either an image it uploaded or
-- one of the tenant's presets, and preset says which. A caller reads the
-- accounts off the page it is answering for, so one query covers all of them;
-- an account that elects no icon, or one the tenant does not hold, answers no
-- rows.
--
-- The election is read here rather than taken from the statement that read
-- the page. An icon changed in between would otherwise be answered as it was
-- before the change, into an answer the storefront may cache after the
-- change's drop has passed: a replaced upload as a URL image-server already
-- refuses, and a preset the reader left as the icon they no longer show.
SELECT u.id AS user_id,
    ui.id AS icon_id,
    false AS preset,
    ui.updated_at,
    uiv.label,
    uiv.content_type,
    uiv.width,
    uiv.height,
    uiv.file_size_bytes
FROM users u
    JOIN user_images ui ON ui.tenant_id = u.tenant_id
        AND ui.id = u.icon_image_id
    JOIN user_image_variants uiv ON uiv.tenant_id = ui.tenant_id
        AND uiv.user_image_id = ui.id
WHERE ui.tenant_id = sqlc.arg('tenant_id')
    AND u.id = ANY(sqlc.arg('user_ids')::uuid[])
UNION ALL
SELECT u.id AS user_id,
    p.id AS icon_id,
    true AS preset,
    p.created_at AS updated_at,
    v.label,
    v.content_type,
    v.width,
    v.height,
    v.file_size_bytes
FROM users u
    JOIN reader_icon_presets p ON p.tenant_id = u.tenant_id
        AND p.id = u.icon_preset_id
    JOIN reader_icon_preset_variants v ON v.tenant_id = p.tenant_id
        AND v.reader_icon_preset_id = p.id
WHERE p.tenant_id = sqlc.arg('tenant_id')
    AND u.id = ANY(sqlc.arg('user_ids')::uuid[])
ORDER BY user_id,
    width DESC,
    label;
