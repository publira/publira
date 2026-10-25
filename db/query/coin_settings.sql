-- name: GetTenantCoinConfig :one
SELECT *
FROM tenant_coin_config
WHERE tenant_id = $1
LIMIT 1;

-- name: EnsureTenantCoinConfig :exec
-- Gives a tenant that has saved nothing its row, with every column at its
-- default, so the save after it always has a row to lock.
INSERT INTO tenant_coin_config (tenant_id)
VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING;

-- name: LockTenantCoinConfig :one
-- Serializes the saves of one tenant's coin settings, so the check that the
-- names hold the default locale's and the write after it see the same rows.
SELECT *
FROM tenant_coin_config
WHERE tenant_id = $1
FOR UPDATE;

-- name: UpdateTenantCoinConfig :one
UPDATE tenant_coin_config
SET enabled = sqlc.arg('enabled'),
    selling = sqlc.arg('selling'),
    coin_unit_amount = sqlc.narg('coin_unit_amount'),
    expiry_days = sqlc.narg('expiry_days'),
    issuer_name = sqlc.arg('issuer_name'),
    terms_url = sqlc.arg('terms_url'),
    contact = sqlc.arg('contact'),
    notice = sqlc.arg('notice'),
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
RETURNING *;

-- name: ListTenantCoinNames :many
-- Every locale's name of the tenant's coin, oldest first.
SELECT *
FROM tenant_coin_name_translations
WHERE tenant_id = $1
ORDER BY created_at,
    id;

-- name: UpsertTenantCoinName :exec
-- Writes one locale's name. A name saved again as it was keeps its updated_at.
INSERT INTO tenant_coin_name_translations (id, tenant_id, locale, name)
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('locale'),
        sqlc.arg('name')
    ) ON CONFLICT (tenant_id, locale) DO
UPDATE
SET name = EXCLUDED.name,
    updated_at = NOW()
WHERE tenant_coin_name_translations.name IS DISTINCT FROM EXCLUDED.name;

-- name: DeleteTenantCoinNamesExcept :exec
-- Removes the names of every locale a save no longer names.
DELETE FROM tenant_coin_name_translations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND NOT (locale = ANY(sqlc.arg('locales')::text []));
