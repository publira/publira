-- name: GetTenantThemeByTenantID :one
SELECT
    t.id AS tenant_id,
    COALESCE(tt.background_color, '#f6f2e9') AS background_color,
    COALESCE(tt.foreground_color, '#1e2b38') AS foreground_color,
    COALESCE(tt.surface_color, '#fbf8f2') AS surface_color,
    COALESCE(tt.surface_foreground_color, '#1e2b38') AS surface_foreground_color,
    COALESCE(tt.card_color, '#fffdf8') AS card_color,
    COALESCE(tt.card_foreground_color, '#1e2b38') AS card_foreground_color,
    COALESCE(tt.popover_color, '#fffdf8') AS popover_color,
    COALESCE(tt.popover_foreground_color, '#1e2b38') AS popover_foreground_color,
    COALESCE(tt.primary_color, '#0f7c82') AS primary_color,
    COALESCE(tt.primary_foreground_color, '#f4fbfb') AS primary_foreground_color,
    COALESCE(tt.secondary_color, '#b35235') AS secondary_color,
    COALESCE(tt.secondary_foreground_color, '#fff6f1') AS secondary_foreground_color,
    COALESCE(tt.accent_color, '#7aae90') AS accent_color,
    COALESCE(tt.accent_foreground_color, '#0f2a1f') AS accent_foreground_color,
    COALESCE(tt.muted_color, '#e9e1d3') AS muted_color,
    COALESCE(tt.muted_foreground_color, '#56616e') AS muted_foreground_color,
    COALESCE(tt.border_color, '#d7ccba') AS border_color,
    COALESCE(tt.input_color, '#e3d8c7') AS input_color,
    COALESCE(tt.ring_color, '#2d8d93') AS ring_color,
    COALESCE(tt.success_color, '#247542') AS success_color,
    COALESCE(tt.success_foreground_color, '#f3fcf7') AS success_foreground_color,
    COALESCE(tt.warning_color, '#9b6217') AS warning_color,
    COALESCE(tt.warning_foreground_color, '#fff8ea') AS warning_foreground_color,
    COALESCE(tt.destructive_color, '#b54444') AS destructive_color,
    COALESCE(tt.destructive_foreground_color, '#fff4f4') AS destructive_foreground_color,
    COALESCE(tt.info_color, '#2b5e9f') AS info_color,
    COALESCE(tt.info_foreground_color, '#f3f8ff') AS info_foreground_color,
    tt.icon_image_id,
    fi.updated_at AS icon_image_updated_at,
    tt.logo_image_id,
    li.updated_at AS logo_image_updated_at,
    COALESCE(tt.updated_at, NOW()) AS updated_at
FROM tenants t
LEFT JOIN tenant_themes tt ON tt.tenant_id = t.id
LEFT JOIN tenant_images fi ON fi.id = tt.icon_image_id
LEFT JOIN tenant_images li ON li.id = tt.logo_image_id
WHERE t.id = $1;

-- name: UpsertTenantTheme :one
INSERT INTO tenant_themes (
        tenant_id,
        background_color,
        foreground_color,
        surface_color,
        surface_foreground_color,
        card_color,
        card_foreground_color,
        popover_color,
        popover_foreground_color,
        primary_color,
        primary_foreground_color,
        secondary_color,
        secondary_foreground_color,
        accent_color,
        accent_foreground_color,
        muted_color,
        muted_foreground_color,
        border_color,
        input_color,
        ring_color,
        success_color,
        success_foreground_color,
        warning_color,
        warning_foreground_color,
        destructive_color,
        destructive_foreground_color,
        info_color,
        info_foreground_color,
        updated_at
    )
VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12,
        $13,
        $14,
        $15,
        $16,
        $17,
        $18,
        $19,
        $20,
        $21,
        $22,
        $23,
        $24,
        $25,
        $26,
        $27,
        $28,
        NOW()
    ) ON CONFLICT (tenant_id) DO
UPDATE
SET background_color = EXCLUDED.background_color,
    foreground_color = EXCLUDED.foreground_color,
    surface_color = EXCLUDED.surface_color,
    surface_foreground_color = EXCLUDED.surface_foreground_color,
    card_color = EXCLUDED.card_color,
    card_foreground_color = EXCLUDED.card_foreground_color,
    popover_color = EXCLUDED.popover_color,
    popover_foreground_color = EXCLUDED.popover_foreground_color,
    primary_color = EXCLUDED.primary_color,
    primary_foreground_color = EXCLUDED.primary_foreground_color,
    secondary_color = EXCLUDED.secondary_color,
    secondary_foreground_color = EXCLUDED.secondary_foreground_color,
    accent_color = EXCLUDED.accent_color,
    accent_foreground_color = EXCLUDED.accent_foreground_color,
    muted_color = EXCLUDED.muted_color,
    muted_foreground_color = EXCLUDED.muted_foreground_color,
    border_color = EXCLUDED.border_color,
    input_color = EXCLUDED.input_color,
    ring_color = EXCLUDED.ring_color,
    success_color = EXCLUDED.success_color,
    success_foreground_color = EXCLUDED.success_foreground_color,
    warning_color = EXCLUDED.warning_color,
    warning_foreground_color = EXCLUDED.warning_foreground_color,
    destructive_color = EXCLUDED.destructive_color,
    destructive_foreground_color = EXCLUDED.destructive_foreground_color,
    info_color = EXCLUDED.info_color,
    info_foreground_color = EXCLUDED.info_foreground_color,
    updated_at = NOW()
RETURNING *;

-- name: SetTenantThemeIconImage :one
-- The theme row is created on demand: a tenant can upload a icon before it
-- has ever saved a color, and the colors then keep their column defaults.
INSERT INTO tenant_themes (tenant_id, icon_image_id, updated_at)
VALUES ($1, $2, NOW()) ON CONFLICT (tenant_id) DO
UPDATE
SET icon_image_id = EXCLUDED.icon_image_id,
    updated_at = NOW()
RETURNING *;

-- name: SetTenantThemeLogoImage :one
-- The theme row is created on demand, the same way the icon does it: a
-- tenant can upload a logo before it has ever saved a color, and the colors
-- then keep their column defaults.
INSERT INTO tenant_themes (tenant_id, logo_image_id, updated_at)
VALUES ($1, $2, NOW()) ON CONFLICT (tenant_id) DO
UPDATE
SET logo_image_id = EXCLUDED.logo_image_id,
    updated_at = NOW()
RETURNING *;

-- name: CreateTenantImage :one
INSERT INTO tenant_images (
        id,
        tenant_id,
        updated_at
    )
VALUES ($1, $2, NOW())
RETURNING *;

-- name: CreateTenantImageVariant :one
INSERT INTO tenant_image_variants (
        id,
        tenant_id,
        tenant_image_id,
        label,
        variant_type,
        storage_provider,
        object_key,
        content_type,
        file_size_bytes,
        width,
        height
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING *;

-- name: ListTenantImageVariantsByImageIDs :many
-- The theme carries the icon and the logo together, so both images' variants
-- are read in one statement rather than one query per slot.
SELECT tenant_image_id,
    variant_type,
    label,
    content_type,
    file_size_bytes,
    width,
    height
FROM tenant_image_variants
WHERE tenant_image_id = ANY(@image_ids::uuid [])
ORDER BY tenant_image_id,
    variant_type;

-- name: DeleteTenantImage :exec
DELETE FROM tenant_images
WHERE id = $1
    AND tenant_id = $2;

-- name: GetTenantImageVariantByTypeForTenant :one
SELECT tiv.object_key,
    tiv.content_type
FROM tenant_image_variants tiv
JOIN tenant_images ti ON ti.id = tiv.tenant_image_id
WHERE tiv.tenant_image_id = $1
    AND ti.tenant_id = $2
    AND tiv.variant_type = $3
LIMIT 1;
