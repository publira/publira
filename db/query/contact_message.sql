-- Messages readers send the tenant through the contact form, and the staff
-- addresses the mail announcing one goes to.
--
-- Expected plans:
--   CreateContactMessage
--     -> contact_messages_tenant_public_id_key for the uniqueness check
--   GetContactMessageByIDForTenant
--     -> contact_messages_pkey
--   GetContactMessageByPublicIDForTenant
--     -> contact_messages_tenant_public_id_key
--   ListContactMessagesByCreatedAt*
--     -> idx_contact_messages_tenant_created_at with no status filter,
--        idx_contact_messages_tenant_unhandled_created_at for 'unhandled',
--        idx_contact_messages_tenant_handled_created_at for 'handled'
--   SetContactMessageHandledByPublicIDForTenant
--     -> contact_messages_tenant_public_id_key
--   ListTenantStaffContactRecipients
--     -> tenant_user_roles_tenant_id_user_id_key, then users_tenant_id_id_key

-- name: CreateContactMessage :one
-- One message as the public API stores it. The sender is nullable because a
-- guest may write: the reply-to address is the only way back either way.
INSERT INTO contact_messages (
    id,
    tenant_id,
    public_id,
    user_id,
    reply_to_email,
    subject,
    body
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('public_id'),
    sqlc.narg('user_id'),
    sqlc.arg('reply_to_email'),
    sqlc.narg('subject'),
    sqlc.arg('body')
)
RETURNING *;

-- name: GetContactMessageByIDForTenant :one
-- What the outbox worker reads to word the staff mail. It is by primary key
-- because the event names the row it was queued for, and it carries the
-- sender's name so the mail can say who wrote without a second round trip.
SELECT m.*,
    u.public_id AS sender_public_id,
    u.name AS sender_name
FROM contact_messages m
    LEFT JOIN users u ON u.tenant_id = m.tenant_id
        AND u.id = m.user_id
WHERE m.tenant_id = sqlc.arg('tenant_id')
    AND m.id = sqlc.arg('id');

-- name: GetContactMessageByPublicIDForTenant :one
-- One message as the console reads it, by the identifier its screens carry.
SELECT m.*,
    u.public_id AS sender_public_id,
    u.name AS sender_name
FROM contact_messages m
    LEFT JOIN users u ON u.tenant_id = m.tenant_id
        AND u.id = m.user_id
WHERE m.tenant_id = sqlc.arg('tenant_id')
    AND m.public_id = sqlc.arg('public_id');

-- name: ListContactMessagesByCreatedAtDesc :many
-- The inbox, newest first. The status filter is the presence of handled_at
-- rather than a column of its own, so the two partial indexes answer it
-- directly: 'unhandled' is the queue staff work from and 'handled' the history
-- behind it.
--
-- cursor rules: proto/README.md.
SELECT m.*,
    u.public_id AS sender_public_id,
    u.name AS sender_name
FROM contact_messages m
    LEFT JOIN users u ON u.tenant_id = m.tenant_id
        AND u.id = m.user_id
WHERE m.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('status')::text IS NULL
        OR (sqlc.narg('status')::text = 'unhandled' AND m.handled_at IS NULL)
        OR (sqlc.narg('status')::text = 'handled' AND m.handled_at IS NOT NULL)
    )
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (m.created_at, m.id) <= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (m.created_at, m.id) < (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY m.created_at DESC,
    m.id DESC
LIMIT sqlc.arg('limit');

-- name: ListContactMessagesByCreatedAtAsc :many
-- The previous-page half of ListContactMessagesByCreatedAtDesc. The handler
-- reverses the returned rows to preserve the newest-first order.
SELECT m.*,
    u.public_id AS sender_public_id,
    u.name AS sender_name
FROM contact_messages m
    LEFT JOIN users u ON u.tenant_id = m.tenant_id
        AND u.id = m.user_id
WHERE m.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('status')::text IS NULL
        OR (sqlc.narg('status')::text = 'unhandled' AND m.handled_at IS NULL)
        OR (sqlc.narg('status')::text = 'handled' AND m.handled_at IS NOT NULL)
    )
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (m.created_at, m.id) >= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (m.created_at, m.id) > (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY m.created_at ASC,
    m.id ASC
LIMIT sqlc.arg('limit');

-- name: SetContactMessageHandledByPublicIDForTenant :one
-- Staff stating which side of the flag a message is on.
--
-- The state is stated rather than toggled, so two members of staff working the
-- same inbox cannot undo each other by pressing at once. A message already in
-- the state asked for keeps the time and the actor it was first marked with:
-- what the row records is when the message was dealt with, and a second press
-- is not a second handling.
UPDATE contact_messages
SET handled_at = CASE
        WHEN NOT sqlc.arg('handled')::boolean THEN NULL
        WHEN handled_at IS NOT NULL THEN handled_at
        ELSE NOW()
    END,
    handled_by = CASE
        WHEN NOT sqlc.arg('handled')::boolean THEN NULL
        WHEN handled_at IS NOT NULL THEN handled_by
        ELSE sqlc.narg('handled_by')
    END
WHERE tenant_id = sqlc.arg('tenant_id')
    AND public_id = sqlc.arg('public_id')
RETURNING *;

-- name: ListTenantStaffContactRecipients :many
-- Who the mail announcing a message goes to: every member of staff the tenant
-- has, with the address their own account is reached at.
--
-- Suspended and inactive accounts are left out. A tenant whose staff were all
-- deactivated is a tenant nobody can be mailed at, which the worker reports
-- rather than working around: sending to an account that cannot sign in would
-- announce a message to somebody who cannot read it.
SELECT DISTINCT u.email
FROM tenant_user_roles tur
    JOIN users u ON u.tenant_id = tur.tenant_id
        AND u.id = tur.user_id
WHERE tur.tenant_id = sqlc.arg('tenant_id')::uuid
    AND (u.status)::text = 'active'
ORDER BY u.email;
