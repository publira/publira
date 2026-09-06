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

-- name: InsertPlatformSettings :one
-- Creates the settings row with the platform default time zone and locale.
-- No ON CONFLICT clause: LockPlatformConfig has nothing to lock when the row is
-- absent, so a losing racer must fail on the primary key rather than overwrite
-- the row the winner just created.
INSERT INTO platform_config (singleton, default_timezone, default_locale, updated_at)
VALUES (
        TRUE,
        sqlc.arg('default_timezone'),
        sqlc.arg('default_locale'),
        NOW()
    )
RETURNING *;

-- name: UpdatePlatformSettings :one
-- Writes the platform default time zone and locale over the existing row. The
-- revision moves with every write, which is what makes a save based on an
-- earlier read detectable.
UPDATE platform_config
SET default_timezone = sqlc.arg('default_timezone'),
    default_locale = sqlc.arg('default_locale'),
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING *;

-- name: UpsertPlatformDefaultLocale :one
-- Stores only the default locale chosen during initial setup. No time zone has
-- been chosen at that point, so a new row leaves it to the column DEFAULT and
-- an existing row keeps the value it already has.
INSERT INTO platform_config (singleton, default_locale, updated_at)
VALUES (TRUE, sqlc.arg('default_locale'), NOW()) ON CONFLICT (singleton) DO
UPDATE
SET default_locale = EXCLUDED.default_locale,
    revision = platform_config.revision + 1,
    updated_at = NOW()
RETURNING *;
