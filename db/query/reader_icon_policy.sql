-- name: GetTenantReaderIconPolicy :one
-- A tenant with no config row has no row here either, and lets readers upload,
-- which is what the column's default says.
SELECT reader_icon_policy
FROM tenant_config
WHERE tenant_id = $1;

-- name: UpsertTenantReaderIconPolicy :one
-- An upsert for the reason UpsertTenantCommentSettings gives.
INSERT INTO tenant_config (tenant_id, reader_icon_policy)
VALUES ($1, $2)
ON CONFLICT (tenant_id) DO UPDATE
SET reader_icon_policy = EXCLUDED.reader_icon_policy,
    updated_at = NOW()
RETURNING *;

-- name: LockTenantForReaderIconSettings :one
-- Taken by a change of the tenant's reader icon settings: the policy, before
-- it clears the icons the new policy no longer allows, and a preset upload,
-- before it counts the presets the tenant holds. Against the share
-- LockTenantForReaderIconChange takes, it lets a reader's icon change in
-- flight commit before the clear reads the accounts, and makes one that
-- arrives later wait and then read the new policy. NO KEY UPDATE rather than
-- UPDATE, so it does not hold back the foreign key checks every write naming
-- the tenant makes.
SELECT id
FROM tenants
WHERE id = $1
FOR NO KEY UPDATE;

-- name: LockTenantForReaderIconChange :one
-- Taken by a reader's icon change before it reads the policy, which is the
-- next statement rather than this one: READ COMMITTED freezes a statement's
-- snapshot when it starts, so a read waiting on the lock here would still see
-- the policy as it was before the wait. The lock is on the tenant rather than
-- its config row, which a tenant that has saved no setting does not have.
SELECT id
FROM tenants
WHERE id = $1
FOR SHARE;

-- name: ClearUploadedReaderIcons :many
-- Leaves every account of the tenant that shows an upload with no icon, for a
-- policy that no longer allows one, answering the accounts it changed. The
-- images are left for the orphan sweep.
UPDATE users
SET icon_image_id = NULL
WHERE tenant_id = $1
    AND icon_image_id IS NOT NULL
RETURNING id;

-- name: ClearAllReaderIcons :many
-- ClearUploadedReaderIcons for a policy that allows no icon at all, which
-- clears the presets accounts elected as well.
UPDATE users
SET icon_image_id = NULL,
    icon_preset_id = NULL
WHERE tenant_id = $1
    AND (
        icon_image_id IS NOT NULL
        OR icon_preset_id IS NOT NULL
    )
RETURNING id;
