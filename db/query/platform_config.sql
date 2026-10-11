-- name: GetPlatformConfig :one
SELECT *
FROM platform_config
WHERE singleton = TRUE
LIMIT 1;

-- name: LockPlatformConfig :one
-- Reads the settings row for update. A save takes this lock first, so the
-- revision it compares against cannot change between the comparison and the
-- write. Returns no rows when the platform has never saved any settings.
SELECT *
FROM platform_config
WHERE singleton = TRUE
FOR UPDATE;

-- name: GetPlatformDefaultCurrency :one
-- The currency of every tenant that has not saved payment settings. The one
-- column the tenant-facing roles may read of this row, so it has a query of
-- its own rather than GetPlatformConfig's whole row.
SELECT default_currency
FROM platform_config
WHERE singleton = TRUE
LIMIT 1;

-- name: PlatformCurrencyHasSales :one
-- Whether a tenant that sells in the platform's default currency, having saved
-- no payment settings of its own, has a purchase, test ones included. Its
-- prices and the amounts it recorded are amounts in that currency, so the
-- default cannot change under it.
SELECT EXISTS (
        SELECT 1
        FROM purchases p
        WHERE NOT EXISTS (
                SELECT 1
                FROM tenant_payment_config c
                WHERE c.tenant_id = p.tenant_id
            )
    );

-- name: ListTenantIDsInDefaultCurrency :many
-- Every tenant that sells in the platform's default currency, having saved no
-- payment settings of its own, and whose site therefore shows its prices in
-- it. Read as publira_platform, which bypasses RLS.
SELECT t.id
FROM tenants t
WHERE NOT EXISTS (
        SELECT 1
        FROM tenant_payment_config c
        WHERE c.tenant_id = t.id
    )
ORDER BY t.id;

-- name: InsertPlatformSettings :one
-- Creates the settings row with the platform default time zone, locale, and
-- currency.
-- No ON CONFLICT clause: LockPlatformConfig has nothing to lock when the row is
-- absent, so a losing racer must fail on the primary key rather than overwrite
-- the row the winner just created.
INSERT INTO platform_config (singleton, default_timezone, default_locale, default_currency, updated_at)
VALUES (
        TRUE,
        sqlc.arg('default_timezone'),
        sqlc.arg('default_locale'),
        sqlc.arg('default_currency'),
        NOW()
    )
RETURNING *;

-- name: UpdatePlatformSettings :one
-- Writes the platform default time zone, locale, and currency over the
-- existing row. The
-- revision moves with every write, which is what makes a save based on an
-- earlier read detectable.
UPDATE platform_config
SET default_timezone = sqlc.arg('default_timezone'),
    default_locale = sqlc.arg('default_locale'),
    default_currency = sqlc.arg('default_currency'),
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING *;
