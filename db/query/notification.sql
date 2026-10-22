-- Worker insert. Same recipient / type / subject is a no-op so retries
-- do not create a second row. Neither RETURNING nor a conflict target: either
-- one needs SELECT on the row, which puts it through the member policy and
-- refuses a row filed for somebody else. The ids are fresh UUIDv7s, so the
-- recipient / type / subject key is the only one an insert can conflict on.
--
-- availability is the surface the notification may be shown on, and a writer
-- that names none files it for every surface, the column's default.
--
-- category is which of the recipient's notification preferences the row
-- answers to, and the row is listed in their inbox unless that preference's
-- inbox cell is off; a recipient who saved nothing holds every cell on, and
-- the staff and everyone categories have no cell. The cell is read here
-- rather than passed in, so no writer can file a row past it. Reading it needs
-- a connection that sees the recipient's settings, which the worker's do: the
-- settings are isolated to the reader they belong to, so a tenant-scoped API
-- connection reads no row and would list every notification it filed, which
-- is why the reader-facing types are filed by the worker.
-- name: CreateNotification :exec
INSERT INTO notifications (
    id,
    tenant_id,
    user_id,
    notification_type,
    subject_key,
    payload,
    availability,
    category,
    in_inbox
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('notification_type'),
    sqlc.arg('subject_key'),
    sqlc.arg('payload'),
    COALESCE(sqlc.narg('availability')::text, 'all'),
    sqlc.arg('category')::text,
    COALESCE((
        SELECT CASE sqlc.arg('category')::text
            WHEN 'followed_episodes' THEN s.followed_episodes_inbox_enabled
            WHEN 'followed_creators' THEN s.followed_creators_inbox_enabled
            WHEN 'comments' THEN s.comments_inbox_enabled
            WHEN 'announcements' THEN s.announcements_inbox_enabled
        END
        FROM user_notification_settings s
        WHERE s.tenant_id = sqlc.arg('tenant_id')
            AND s.user_id = sqlc.arg('user_id')
    ), true)
)
ON CONFLICT DO NOTHING;

-- A row filed for the tenant's staff for being staff, which no preference
-- governs, so it is listed in their inbox whatever else shares its key. The
-- scheduled publication tells the staff about an episode its followers are told
-- about too, under the same recipient / type / subject, and a member of staff
-- who follows the episode already holds the follower's row, listed or not by
-- their own inbox cell. That row is kept, so its push still answers to their
-- preferences, and listed. The conflict target needs SELECT on the row, so only
-- the roles that reach every tenant's rows run this.
-- name: CreateStaffNotification :exec
INSERT INTO notifications (
    id,
    tenant_id,
    user_id,
    notification_type,
    subject_key,
    payload,
    category,
    in_inbox
)
VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('notification_type'),
    sqlc.arg('subject_key'),
    sqlc.arg('payload'),
    sqlc.arg('category')::text,
    true
)
ON CONFLICT (user_id, notification_type, subject_key) DO UPDATE
SET in_inbox = true;

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
--
-- surface is the reader's surface, 'web' or 'app', and keeps the rows that
-- may be shown on it; the unread count and "mark all as read" take the same
-- one, so a surface counts and marks only what it lists. The tenant console,
-- which is neither surface and lists what is addressed to an admin, passes
-- NULL and reads every row of either surface.
--
-- A row filed with its inbox cell off (in_inbox) is in no inbox, so all four
-- leave it out: it exists only for the push that mirrors it.
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
    AND n.in_inbox
    AND (
        sqlc.narg('surface')::text IS NULL
        OR n.availability = ANY (ARRAY['all'::text, sqlc.narg('surface')::text])
    )
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
    AND n.in_inbox
    AND (
        sqlc.narg('surface')::text IS NULL
        OR n.availability = ANY (ARRAY['all'::text, sqlc.narg('surface')::text])
    )
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
    AND n.in_inbox
    AND (
        sqlc.narg('surface')::text IS NULL
        OR n.availability = ANY (ARRAY['all'::text, sqlc.narg('surface')::text])
    )
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
SET read_at = notification_reads.read_at
RETURNING *;

-- name: MarkPlatformNotificationAsRead :one
INSERT INTO platform_notification_reads (platform_notification_id, platform_user_id, read_at)
SELECT n.id, sqlc.arg('platform_user_id'), NOW()
FROM platform_notifications n
WHERE n.id = sqlc.arg('id')
    AND n.platform_user_id = sqlc.arg('platform_user_id')
ON CONFLICT (platform_notification_id, platform_user_id) DO UPDATE
SET read_at = platform_notification_reads.read_at
RETURNING *;

-- name: MarkAllNotificationsAsRead :execrows
INSERT INTO notification_reads (notification_id, user_id, tenant_id, read_at)
SELECT n.id, sqlc.arg('user_id'), n.tenant_id, NOW()
FROM notifications n
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.user_id = sqlc.arg('user_id')
    AND n.in_inbox
    AND (
        sqlc.narg('surface')::text IS NULL
        OR n.availability = ANY (ARRAY['all'::text, sqlc.narg('surface')::text])
    )
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

-- name: ListNotificationEmailRecipients :many
-- Worker mail: the recipients one notification still owes a mail, a page at a
-- time in recipient order. A row is owed one until it is marked emailed, so a
-- retry of the event finds only the readers no earlier run reached.
--
-- The recipient's email cell for the row's category decides, every cell on
-- for a reader who saved nothing, and a row for everyone has no cell. A row
-- filed for staff for being staff is never mailed: they read the console's
-- bell. A notification shown on the app alone is not mailed either, because
-- the mail links into the site. The address has to be one the reader
-- confirmed and the account active, which is what every mail to a reader
-- takes.
--
-- The recipient / type / subject key is unique, so user_id alone orders the
-- rows of one notification, and `idx_notifications_tenant_subject_user` walks
-- them in that order. The nil UUID sorts below every UUID, so it is what the
-- first page asks for.
SELECT n.id AS notification_id,
    n.user_id,
    n.category,
    n.payload,
    u.email
FROM notifications n
    JOIN users u
        ON u.tenant_id = n.tenant_id
        AND u.id = n.user_id
    LEFT JOIN user_notification_settings s
        ON s.tenant_id = n.tenant_id
        AND s.user_id = n.user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.notification_type = sqlc.arg('notification_type')
    AND n.subject_key = sqlc.arg('subject_key')
    AND n.user_id > sqlc.arg('after_user_id')::uuid
    AND n.emailed_at IS NULL
    AND n.availability = ANY (ARRAY['all'::text, 'web'::text])
    AND u.status = 'active'
    AND u.email_verified_at IS NOT NULL
    AND CASE n.category
        WHEN 'everyone' THEN true
        WHEN 'followed_episodes' THEN COALESCE(s.followed_episodes_email_enabled, true)
        WHEN 'followed_creators' THEN COALESCE(s.followed_creators_email_enabled, true)
        WHEN 'comments' THEN COALESCE(s.comments_email_enabled, true)
        WHEN 'announcements' THEN COALESCE(s.announcements_email_enabled, true)
        ELSE false
    END
ORDER BY n.user_id
LIMIT sqlc.arg('page_size');

-- name: MarkNotificationEmailed :exec
-- Worker mail: records that a row's recipient was mailed about it, once the
-- relay accepted the mail.
UPDATE notifications
SET emailed_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND emailed_at IS NULL;
