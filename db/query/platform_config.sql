-- name: GetPlatformConfig :one
SELECT *
FROM platform_config
WHERE singleton = TRUE
LIMIT 1;

-- name: UpsertPlatformSettings :one
-- Creates or updates the platform default time zone and default locale in one
-- statement. default_locale has no column DEFAULT, so the caller always states
-- a value for it.
INSERT INTO platform_config (singleton, default_timezone, default_locale, updated_at)
VALUES (
        TRUE,
        sqlc.arg('default_timezone'),
        sqlc.arg('default_locale'),
        NOW()
    ) ON CONFLICT (singleton) DO
UPDATE
SET default_timezone = EXCLUDED.default_timezone,
    default_locale = EXCLUDED.default_locale,
    updated_at = NOW()
RETURNING *;

-- name: UpsertPlatformDefaultLocale :one
-- Stores only the default locale chosen during initial setup. No time zone has
-- been chosen at that point, so a new row leaves it to the column DEFAULT and
-- an existing row keeps the value it already has.
INSERT INTO platform_config (singleton, default_locale, updated_at)
VALUES (TRUE, sqlc.arg('default_locale'), NOW()) ON CONFLICT (singleton) DO
UPDATE
SET default_locale = EXCLUDED.default_locale,
    updated_at = NOW()
RETURNING *;
