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

-- name: GetTenantCoinOffer :one
-- What a reader is told about the tenant's coins: the settings, and the coin's
-- name in the locale asked for, else the tenant default locale's, else the
-- oldest. No row is a tenant that has saved nothing.
SELECT c.enabled,
    c.selling,
    c.coin_unit_amount,
    c.expiry_days,
    c.issuer_name,
    c.terms_url,
    c.contact,
    c.notice,
    -- Empty when the tenant has named the coin in no locale: sqlc reads the
    -- columns of a function's row as never NULL.
    COALESCE(n.name, '')::text AS coin_name
FROM tenant_coin_config c
    LEFT JOIN LATERAL tenant_coin_name_for(c.tenant_id, sqlc.arg('locale')::text) n ON TRUE
WHERE c.tenant_id = sqlc.arg('tenant_id');

-- name: LockTenantCoinConfigForSpend :one
-- The tenant's coin settings as a spend reads them, held against a save until
-- the spend commits, so a spend never lands after the save that turned coins
-- off or changed what one is worth.
SELECT enabled,
    coin_unit_amount
FROM tenant_coin_config
WHERE tenant_id = $1
FOR SHARE;

-- name: ListTenantsWithCoinsEnabled :many
-- Every tenant that has turned its coins on, across every tenant: the ones
-- whose storefronts change when the platform allows or forbids tenant coins.
SELECT tenant_id
FROM tenant_coin_config
WHERE enabled
ORDER BY tenant_id;
