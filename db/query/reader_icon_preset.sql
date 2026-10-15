-- name: CreateReaderIconPreset :one
-- created_at is the moment of the insert rather than the transaction's start,
-- which is what now() would give: the uploads of one tenant wait on each other
-- for the tenant's lock, and the one that waited began first.
INSERT INTO reader_icon_presets (id, tenant_id, created_at)
VALUES ($1, $2, clock_timestamp())
RETURNING *;

-- name: CreateReaderIconPresetVariant :one
INSERT INTO reader_icon_preset_variants (
        id,
        tenant_id,
        reader_icon_preset_id,
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

-- name: CountReaderIconPresets :one
SELECT COUNT(*)::int
FROM reader_icon_presets
WHERE tenant_id = $1;

-- name: ListReaderIconPresetVariants :many
-- Every preset of the tenant with its stored variants, oldest preset first.
-- created_at leads rather than the id: a UUIDv7 rises monotonically only
-- within the process that made it, and uploads reach several, while
-- created_at is read off the database's one clock.
SELECT p.id AS reader_icon_preset_id,
    p.created_at,
    v.label,
    v.content_type,
    v.width,
    v.height,
    v.file_size_bytes
FROM reader_icon_presets p
    JOIN reader_icon_preset_variants v ON v.tenant_id = p.tenant_id
        AND v.reader_icon_preset_id = p.id
WHERE p.tenant_id = $1
ORDER BY p.created_at,
    p.id,
    v.width DESC,
    v.label;

-- name: LockReaderIconPreset :one
-- Locks a preset before it is deleted. An account electing it takes a key
-- share on the row through its foreign key, so the lock waits for an election
-- in flight to commit, and the clear that follows sees it; an election that
-- arrives after the lock waits in turn and then finds the preset gone.
SELECT id
FROM reader_icon_presets
WHERE tenant_id = $1
    AND id = $2
FOR UPDATE;

-- name: ClearReaderIconPresetElections :many
-- Leaves every account that shows the preset with no icon, answering the
-- accounts it changed so the caller can name the comment lists that showed it.
-- The foreign key would clear them on the delete too, but without saying which.
UPDATE users
SET icon_preset_id = NULL
WHERE tenant_id = @tenant_id
    AND icon_preset_id = @reader_icon_preset_id
RETURNING id;

-- name: DeleteReaderIconPreset :execrows
-- The variants go with the row, and their objects are left for the orphan
-- sweep, which deletes an object once no variant row names it.
DELETE FROM reader_icon_presets
WHERE tenant_id = $1
    AND id = $2;

-- name: SetUserIconPreset :execrows
-- Elects one of the tenant's presets as the account's icon. An account shows
-- one icon, so an upload it elected is cleared with it and left for the orphan
-- sweep. A preset the tenant does not hold fails the foreign key.
UPDATE users
SET icon_preset_id = @icon_preset_id,
    icon_image_id = NULL
WHERE tenant_id = @tenant_id
    AND id = @id;

-- name: GetReaderIconPresetImageForTenant :one
-- The stored object behind a preset, for image-server. A deleted preset answers
-- no rows, so its URL stops answering at once rather than when the orphan sweep
-- reclaims the object.
SELECT v.object_key,
    v.content_type
FROM reader_icon_preset_variants v
WHERE v.tenant_id = $2
    AND v.reader_icon_preset_id = $1
ORDER BY v.width DESC
LIMIT 1;
