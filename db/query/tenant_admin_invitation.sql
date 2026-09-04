-- name: CreateTenantAdminInvitation :one
INSERT INTO tenant_admin_invitations (
        id,
        tenant_id,
        email,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: GetTenantAdminInvitationByTenantAndEmail :one
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = $1
    AND email = $2
LIMIT 1;

-- name: GetTenantAdminInvitationByIDForTenant :one
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = $1
    AND id = $2
LIMIT 1;

-- name: GetTenantAdminInvitationByHashForTenant :one
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = $1
    AND token_hash = $2
LIMIT 1;

-- name: UpdateTenantAdminInvitationForResend :one
UPDATE tenant_admin_invitations
SET token_hash = $3,
    expires_at = $4,
    canceled_at = NULL,
    updated_at = NOW()
WHERE tenant_id = $1
    AND email = $2
RETURNING *;

-- name: CancelTenantAdminInvitation :one
UPDATE tenant_admin_invitations
SET canceled_at = COALESCE(canceled_at, NOW()),
    updated_at = NOW()
WHERE tenant_id = $1
    AND id = $2
RETURNING *;

-- name: MarkTenantAdminInvitationAccepted :one
UPDATE tenant_admin_invitations
SET accepted_at = COALESCE(accepted_at, NOW()),
    updated_at = NOW()
WHERE tenant_id = $1
    AND id = $2
RETURNING *;

-- Platform ListTenantAdminInvitations is (created_at, id) DESC. Forward uses
-- the DESC query; backward uses ASC so the index can be scanned in reverse.
-- The handler flips ASC rows back into display order.
-- cursor rules: proto/README.md.
-- name: ListTenantAdminInvitationsDesc :many
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND (
        accepted_at IS NULL
        OR accepted_at >= NOW() - INTERVAL '7 days'
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (created_at, id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (created_at, id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg('limit');

-- name: ListTenantAdminInvitationsAsc :many
SELECT *
FROM tenant_admin_invitations
WHERE tenant_id = sqlc.arg('tenant_id')
    AND (
        accepted_at IS NULL
        OR accepted_at >= NOW() - INTERVAL '7 days'
    )
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (created_at, id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (created_at, id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY created_at ASC, id ASC
LIMIT sqlc.arg('limit');
