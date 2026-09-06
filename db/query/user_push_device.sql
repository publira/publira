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
    platform
)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('token'),
    sqlc.arg('platform')
)
ON CONFLICT (token) DO UPDATE
SET
    user_id = EXCLUDED.user_id,
    platform = EXCLUDED.platform,
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

-- Every device to push one notification to, one row per recipient device. The
-- notification id travels with the token because the push mirrors that row and
-- the app routes from it.
-- name: ListPushDevicesForNotification :many
SELECT
    n.id AS notification_id,
    d.user_id,
    d.token,
    d.platform
FROM notifications n
    JOIN user_push_devices d
        ON d.tenant_id = n.tenant_id
        AND d.user_id = n.user_id
WHERE n.tenant_id = sqlc.arg('tenant_id')
    AND n.notification_type = sqlc.arg('notification_type')
    AND n.subject_key = sqlc.arg('subject_key')
ORDER BY d.token;
