-- Worker insert. Same recipient / type / subject is a no-op so retries
-- do not create a second row. :one returns no rows on conflict.
-- name: CreateNotification :one
INSERT INTO notifications (
    id,
    tenant_id,
    user_id,
    notification_type,
    subject_key,
    payload
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('notification_type'),
    sqlc.arg('subject_key'),
    sqlc.arg('payload')
)
ON CONFLICT (user_id, notification_type, subject_key) DO NOTHING
RETURNING *;

-- name: CreatePlatformNotification :one
INSERT INTO platform_notifications (
    id,
    platform_user_id,
    notification_type,
    subject_key,
    payload
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('platform_user_id'),
    sqlc.arg('notification_type'),
    sqlc.arg('subject_key'),
    sqlc.arg('payload')
)
ON CONFLICT (platform_user_id, notification_type, subject_key) DO NOTHING
RETURNING *;

-- ListNotifications is (created_at, id) DESC. Forward uses the DESC query;
-- backward uses ASC so the index can be scanned in reverse. The handler
-- flips ASC rows back into display order. Do not parameterize ORDER BY.
-- cursor rules: proto/README.md.
-- name: ListNotificationsForUserDesc :many
SELECT
    n.id,
    n.tenant_id,
    n.user_id,
    n.notification_type,
    n.subject_key,
    n.payload,
    n.created_at,
    (nr.notification_id IS NOT NULL)::bool AS is_read,
    nr.read_at
FROM notifications n
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.user_id = sqlc.arg('user_id')
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

-- name: ListNotificationsForUserAsc :many
SELECT
    n.id,
    n.tenant_id,
    n.user_id,
    n.notification_type,
    n.subject_key,
    n.payload,
    n.created_at,
    (nr.notification_id IS NOT NULL)::bool AS is_read,
    nr.read_at
FROM notifications n
    LEFT JOIN notification_reads nr ON nr.notification_id = n.id
    AND nr.user_id = sqlc.arg('user_id')
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.user_id = sqlc.arg('user_id')
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

-- name: ListPlatformNotificationsForUserDesc :many
SELECT
    n.id,
    n.platform_user_id,
    n.notification_type,
    n.subject_key,
    n.payload,
    n.created_at,
    (nr.platform_notification_id IS NOT NULL)::bool AS is_read,
    nr.read_at
FROM platform_notifications n
    LEFT JOIN platform_notification_reads nr ON nr.platform_notification_id = n.id
    AND nr.platform_user_id = sqlc.arg('platform_user_id')
WHERE n.platform_user_id = sqlc.arg('platform_user_id')
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

-- name: ListPlatformNotificationsForUserAsc :many
SELECT
    n.id,
    n.platform_user_id,
    n.notification_type,
    n.subject_key,
    n.payload,
    n.created_at,
    (nr.platform_notification_id IS NOT NULL)::bool AS is_read,
    nr.read_at
FROM platform_notifications n
    LEFT JOIN platform_notification_reads nr ON nr.platform_notification_id = n.id
    AND nr.platform_user_id = sqlc.arg('platform_user_id')
WHERE n.platform_user_id = sqlc.arg('platform_user_id')
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

-- name: CountUnreadNotificationsForUser :one
SELECT COUNT(*)::int AS unread_count
FROM notifications n
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.user_id = sqlc.arg('user_id')
    AND NOT EXISTS (
        SELECT 1
        FROM notification_reads nr
        WHERE nr.notification_id = n.id
            AND nr.user_id = sqlc.arg('user_id')
    );

-- name: CountUnreadPlatformNotificationsForUser :one
SELECT COUNT(*)::int AS unread_count
FROM platform_notifications n
WHERE n.platform_user_id = sqlc.arg('platform_user_id')
    AND NOT EXISTS (
        SELECT 1
        FROM platform_notification_reads nr
        WHERE nr.platform_notification_id = n.id
            AND nr.platform_user_id = sqlc.arg('platform_user_id')
    );

-- name: MarkNotificationAsRead :one
INSERT INTO notification_reads (notification_id, user_id, tenant_id, read_at)
SELECT n.id, sqlc.arg('user_id'), n.tenant_id, NOW()
FROM notifications n
WHERE n.id = sqlc.arg('id')
    AND n.tenant_id = sqlc.arg('tenant_id')
    AND n.user_id = sqlc.arg('user_id')
ON CONFLICT (notification_id, user_id) DO UPDATE
SET read_at = EXCLUDED.read_at
RETURNING *;

-- name: MarkPlatformNotificationAsRead :one
INSERT INTO platform_notification_reads (platform_notification_id, platform_user_id, read_at)
SELECT n.id, sqlc.arg('platform_user_id'), NOW()
FROM platform_notifications n
WHERE n.id = sqlc.arg('id')
    AND n.platform_user_id = sqlc.arg('platform_user_id')
ON CONFLICT (platform_notification_id, platform_user_id) DO UPDATE
SET read_at = EXCLUDED.read_at
RETURNING *;

-- name: MarkAllNotificationsAsRead :execrows
INSERT INTO notification_reads (notification_id, user_id, tenant_id, read_at)
SELECT n.id, sqlc.arg('user_id'), n.tenant_id, NOW()
FROM notifications n
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.user_id = sqlc.arg('user_id')
    AND NOT EXISTS (
        SELECT 1
        FROM notification_reads nr
        WHERE nr.notification_id = n.id
            AND nr.user_id = sqlc.arg('user_id')
    )
ON CONFLICT (notification_id, user_id) DO NOTHING;

-- name: MarkAllPlatformNotificationsAsRead :execrows
INSERT INTO platform_notification_reads (platform_notification_id, platform_user_id, read_at)
SELECT n.id, sqlc.arg('platform_user_id'), NOW()
FROM platform_notifications n
WHERE n.platform_user_id = sqlc.arg('platform_user_id')
    AND NOT EXISTS (
        SELECT 1
        FROM platform_notification_reads nr
        WHERE nr.platform_notification_id = n.id
            AND nr.platform_user_id = sqlc.arg('platform_user_id')
    )
ON CONFLICT (platform_notification_id, platform_user_id) DO NOTHING;
