-- name: GetPlatformStorageConfig :one
-- Returns no rows when the platform has never saved an object store, which is
-- the "not configured" state the console shows.
SELECT *
FROM platform_storage_config
WHERE singleton = TRUE;

-- name: LockPlatformStorageConfig :one
-- Reads the row for update, so the revision a save compares against cannot
-- change between the comparison and the write.
SELECT *
FROM platform_storage_config
WHERE singleton = TRUE
FOR UPDATE;

-- name: InsertPlatformStorageConfig :one
-- No ON CONFLICT clause: an absent row leaves LockPlatformStorageConfig
-- nothing to lock, so a losing racer must fail on the primary key rather than
-- overwrite the row the winner just created.
INSERT INTO platform_storage_config (
        singleton,
        bucket,
        region,
        endpoint,
        force_path_style,
        public_base_url,
        access_key_id,
        secret_access_key_encrypted,
        updated_at
    )
VALUES (
        TRUE,
        sqlc.arg('bucket'),
        sqlc.arg('region'),
        sqlc.narg('endpoint'),
        sqlc.arg('force_path_style'),
        sqlc.narg('public_base_url'),
        sqlc.narg('access_key_id'),
        sqlc.narg('secret_access_key_encrypted'),
        NOW()
    )
RETURNING *;

-- name: UpdatePlatformStorageConfig :one
-- Writes every value over the existing row. The revision moves with every
-- write, which is what makes a save based on an earlier read detectable.
UPDATE platform_storage_config
SET bucket = sqlc.arg('bucket'),
    region = sqlc.arg('region'),
    endpoint = sqlc.narg('endpoint'),
    force_path_style = sqlc.arg('force_path_style'),
    public_base_url = sqlc.narg('public_base_url'),
    access_key_id = sqlc.narg('access_key_id'),
    secret_access_key_encrypted = sqlc.narg('secret_access_key_encrypted'),
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING *;
