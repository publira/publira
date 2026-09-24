-- Records the FCM registration token the reader app holds. The token is the
-- primary key, so a device that changes hands moves to the new reader instead
-- of leaving a second row behind that would push one reader's episodes to the
-- next.
--
-- The update never touches tenant_id, and a row cannot move between tenants.
-- It has no reason to: a build of the app serves one tenant and one Firebase
-- project, and FCM issues a token per install of it, so the token names a
-- device that belongs to that tenant alone. A conflict with another tenant's
-- row is therefore not a state the app can produce, and it fails rather than
-- resolving: this statement runs under the RLS-bound API role, which cannot
-- see that row, and PostgreSQL raises on an ON CONFLICT DO UPDATE whose
-- existing row fails the policy. A hard error is the outcome to want — the
-- alternative would be one tenant's caller taking a device away from another.
-- name: UpsertUserPushDevice :one
INSERT INTO user_push_devices (
    tenant_id,
    user_id,
    token,
    platform,
    endpoint,
    p256dh,
    auth
)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('token'),
    sqlc.arg('platform'),
    sqlc.narg('endpoint'),
    sqlc.narg('p256dh'),
    sqlc.narg('auth')
)
ON CONFLICT (token) DO UPDATE
SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
    endpoint = EXCLUDED.endpoint,
    p256dh = EXCLUDED.p256dh,
    auth = EXCLUDED.auth,
    updated_at = NOW()
RETURNING *;

-- Sign-out and the account switch both unregister, and both name the reader
-- who holds the session, so a token cannot be dropped from another account.
-- name: DeleteUserPushDeviceForUser :execrows
DELETE FROM user_push_devices
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND token = sqlc.arg('token');

-- The send path's answer to a token FCM reports as revoked. It runs in the
-- outbox worker, which knows the token and not who registered it.
-- name: DeleteUserPushDeviceByToken :execrows
DELETE FROM user_push_devices
WHERE token = sqlc.arg('token');

-- One page of the devices to push one notification to, ordered by recipient
-- and token after the previous page's last pair (the nil UUID and an empty
-- token for the first page). The walk runs over the notification's recipients
-- in idx_notifications_tenant_subject_user, so a page costs the recipients it
-- passes rather than every device the tenant has. The separate user_id bound is
-- what the index can start from, since the pair spans both tables.
-- name: ListPushDevicesForNotification :many
SELECT
    n.id AS notification_id,
    d.user_id,
    d.token,
    d.platform,
    d.endpoint,
    d.p256dh,
    d.auth
FROM notifications n
    JOIN user_push_devices d
        ON d.tenant_id = n.tenant_id
        AND d.user_id = n.user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.notification_type = sqlc.arg('notification_type')
    AND n.subject_key = sqlc.arg('subject_key')
    AND n.user_id >= sqlc.arg('after_user_id')::uuid
    AND (n.user_id, d.token) > (sqlc.arg('after_user_id')::uuid, sqlc.arg('after_token')::text)
ORDER BY n.user_id, d.token
LIMIT sqlc.arg('page_size');
