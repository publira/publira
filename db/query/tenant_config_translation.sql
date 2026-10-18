-- name: GetTenantConfigTranslationFor :one
-- The copy a reader in locale is served, picked by
-- tenant_config_translation_for. No row when the tenant has written none.
SELECT tct.*
FROM tenant_config_translation_for(sqlc.arg('tenant_id')::uuid, sqlc.arg('locale')::text) tct;

-- name: GetTenantConfigTranslation :one
-- The copy written in exactly locale, which is what the console edits: no
-- other locale's stands in for it.
SELECT *
FROM tenant_config_translations
WHERE tenant_id = $1
    AND locale = $2;

-- name: LockTenantConfigTranslation :one
-- Serializes a save of one locale's copy against another save of the same
-- locale, so a save skipped as unchanged answers what the row still holds.
-- A locale with no row has nothing to lock, and its first save inserts it
-- through the upsert.
SELECT *
FROM tenant_config_translations
WHERE tenant_id = $1
    AND locale = $2
FOR UPDATE;

-- name: UpsertTenantConfigTranslation :one
INSERT INTO tenant_config_translations (id, tenant_id, locale, site_tagline, site_description, copyright_text)
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('locale'),
        sqlc.arg('site_tagline'),
        sqlc.arg('site_description'),
        sqlc.arg('copyright_text')
    )
ON CONFLICT (tenant_id, locale) DO UPDATE
SET site_tagline = EXCLUDED.site_tagline,
    site_description = EXCLUDED.site_description,
    copyright_text = EXCLUDED.copyright_text,
    updated_at = NOW()
RETURNING *;

-- name: DeleteTenantConfigTranslation :execrows
-- A locale whose copy is cleared has no row, so its readers are served the
-- copy tenant_config_translation_for falls back to.
DELETE FROM tenant_config_translations
WHERE tenant_id = $1
    AND locale = $2;
