-- name: CreateAnnouncement :one
INSERT INTO announcements (
    id,
    tenant_id,
    target_user_id,
    announcement_type,
    title,
    body,
    link_url,
    metadata
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- Admin ListAnnouncements is (created_at, id) DESC. Forward uses the DESC
-- query; backward uses ASC so idx_announcements_tenant_created_at can be
-- scanned in reverse. The handler flips ASC rows back into display order.
-- A parameterized ORDER BY cannot be read in index order, so each scan
-- direction gets its own query.
-- cursor rules: proto/README.md.
-- name: ListAnnouncementsForTenantDesc :many
SELECT
    n.id,
    n.tenant_id,
    n.target_user_id,
    n.announcement_type,
    n.title,
    n.body,
    n.link_url,
    n.metadata,
    n.created_at,
    u.public_id AS target_user_public_id,
    u.name AS target_user_name
FROM announcements n
    LEFT JOIN users u ON u.id = n.target_user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAnnouncementsForTenantAsc :many
SELECT
    n.id,
    n.tenant_id,
    n.target_user_id,
    n.announcement_type,
    n.title,
    n.body,
    n.link_url,
    n.metadata,
    n.created_at,
    u.public_id AS target_user_public_id,
    u.name AS target_user_name
FROM announcements n
    LEFT JOIN users u ON u.id = n.target_user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at ASC, n.id ASC
LIMIT sqlc.arg('limit');

-- The public site's ListAnnouncements is (created_at, id) DESC. Forward uses
-- the DESC query; backward uses ASC so the index can be scanned in reverse.
-- The handler flips ASC rows back into display order. A parameterized
-- ORDER BY cannot be read in index order, so each scan direction gets its own
-- query. Every row carries the calling user's read state.
-- cursor rules: proto/README.md.
-- name: ListAnnouncementsForUserDesc :many
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'))
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at DESC, n.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAnnouncementsForUserAsc :many
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'))
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (n.created_at, n.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY n.created_at ASC, n.id ASC
LIMIT sqlc.arg('limit');

-- name: GetAnnouncementForUser :one
-- Returns the announcement with the caller's read state, and only when the row
-- belongs to that caller's inbox. A row addressed to another user or owned by
-- another tenant comes back as no rows, so its existence is not disclosed.
SELECT
    n.*,
    (nr.announcement_id IS NOT NULL) AS is_read,
    nr.read_at
FROM announcements n
    LEFT JOIN announcement_reads nr ON nr.announcement_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.id = sqlc.arg('id')
    AND n.tenant_id = sqlc.arg('tenant_id')
    AND (n.target_user_id IS NULL OR n.target_user_id = sqlc.arg('user_id'));

-- name: MarkAnnouncementAsRead :one
-- Upserts, so marking an already-read announcement refreshes read_at instead
-- of failing. The SELECT confines the insert to the caller's own inbox.
INSERT INTO announcement_reads (announcement_id, user_id, read_at)
SELECT n.id, $3, NOW()
FROM announcements n
WHERE n.id = $1
    AND n.tenant_id = $2
    AND (n.target_user_id IS NULL OR n.target_user_id = $3)
ON CONFLICT (announcement_id, user_id) DO UPDATE
SET read_at = EXCLUDED.read_at
RETURNING *;

-- name: MarkAllAnnouncementsAsRead :execrows
-- Inserts a read row for every announcement in the caller's inbox that lacks
-- one: the tenant-wide announcements plus the ones addressed to that user.
INSERT INTO announcement_reads (announcement_id, user_id, read_at)
SELECT n.id, $2, NOW()
FROM announcements n
WHERE n.tenant_id = $1
    AND (n.target_user_id IS NULL OR n.target_user_id = $2)
    AND NOT EXISTS (
        SELECT 1
        FROM announcement_reads nr
        WHERE nr.announcement_id = n.id
            AND nr.user_id = $2
    )
ON CONFLICT (announcement_id, user_id) DO NOTHING;
