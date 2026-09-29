-- name: GetPlatformRetentionConfig :one
-- Returns no rows when the platform has never saved its retention defaults,
-- which the server answers with its built-in defaults.
SELECT *
FROM platform_retention_config
WHERE singleton = TRUE;

-- name: LockPlatformRetentionConfig :one
-- Reads the defaults row for update, so the revision a save compares against
-- cannot change between the comparison and the write.
SELECT *
FROM platform_retention_config
WHERE singleton = TRUE
FOR UPDATE;

-- name: InsertPlatformRetentionConfig :one
-- No ON CONFLICT clause: an absent row leaves LockPlatformRetentionConfig
-- nothing to lock, so a losing racer must fail on the primary key rather than
-- overwrite the row the winner just created.
INSERT INTO platform_retention_config (
        singleton,
        withdrawn_comment_days,
        content_event_days,
        daily_ranking_snapshot_days,
        weekly_ranking_snapshot_days,
        updated_at
    )
VALUES (
        TRUE,
        sqlc.arg('withdrawn_comment_days'),
        sqlc.arg('content_event_days'),
        sqlc.arg('daily_ranking_snapshot_days'),
        sqlc.arg('weekly_ranking_snapshot_days'),
        NOW()
    )
RETURNING *;

-- name: UpdatePlatformRetentionConfig :one
UPDATE platform_retention_config
SET withdrawn_comment_days = sqlc.arg('withdrawn_comment_days'),
    content_event_days = sqlc.arg('content_event_days'),
    daily_ranking_snapshot_days = sqlc.arg('daily_ranking_snapshot_days'),
    weekly_ranking_snapshot_days = sqlc.arg('weekly_ranking_snapshot_days'),
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton = TRUE
RETURNING *;

-- name: GetTenantRetentionSettings :one
-- Returns no rows when the tenant has never saved an override.
SELECT *
FROM tenant_retention_settings
WHERE tenant_id = sqlc.arg('tenant_id');

-- name: ListTenantRetentionSettings :many
-- Every tenant's overrides, for a batch that spans all tenants. A tenant with
-- no row follows the platform defaults.
SELECT *
FROM tenant_retention_settings
ORDER BY tenant_id;

-- name: LockTenantRetentionSettings :one
SELECT *
FROM tenant_retention_settings
WHERE tenant_id = sqlc.arg('tenant_id')
FOR UPDATE;

-- name: InsertTenantRetentionSettings :one
-- No ON CONFLICT clause, for the same reason as InsertPlatformRetentionConfig.
INSERT INTO tenant_retention_settings (
        tenant_id,
        withdrawn_comment_days,
        content_event_days,
        daily_ranking_snapshot_days,
        weekly_ranking_snapshot_days,
        updated_at
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.narg('withdrawn_comment_days'),
        sqlc.narg('content_event_days'),
        sqlc.narg('daily_ranking_snapshot_days'),
        sqlc.narg('weekly_ranking_snapshot_days'),
        NOW()
    )
RETURNING *;

-- name: UpdateTenantRetentionSettings :one
UPDATE tenant_retention_settings
SET withdrawn_comment_days = sqlc.narg('withdrawn_comment_days'),
    content_event_days = sqlc.narg('content_event_days'),
    daily_ranking_snapshot_days = sqlc.narg('daily_ranking_snapshot_days'),
    weekly_ranking_snapshot_days = sqlc.narg('weekly_ranking_snapshot_days'),
    revision = revision + 1,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
RETURNING *;
