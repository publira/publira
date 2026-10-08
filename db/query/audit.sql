-- name: InsertPlatformAuditLog :exec
INSERT INTO platform_audit_logs (
    id,
    actor_platform_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    outcome,
    reason,
    client_ip,
    tenant_id
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);

-- An entry can land after its actor's account is gone: the async recorder
-- writes it once the request has answered, and the account can be deleted in
-- between. The trigger that keeps a deleted actor only reaches entries already
-- written, so this one files itself the same way, under the public ID and name
-- the caller kept, rather than failing the foreign key and being dropped.
-- name: InsertAuditLog :exec
INSERT INTO audit_logs (
    id,
    tenant_id,
    actor_user_id,
    actor_role,
    actor_public_id,
    actor_name,
    action,
    target_type,
    target_id,
    outcome,
    reason,
    client_ip
)
SELECT sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    actor.id,
    sqlc.arg('actor_role'),
    CASE
        WHEN sqlc.narg('actor_user_id')::uuid IS NOT NULL AND actor.id IS NULL THEN sqlc.narg('actor_public_id')::text
    END,
    CASE
        WHEN sqlc.narg('actor_user_id')::uuid IS NOT NULL AND actor.id IS NULL THEN sqlc.narg('actor_name')::text
    END,
    sqlc.arg('action'),
    sqlc.narg('target_type'),
    sqlc.narg('target_id'),
    sqlc.arg('outcome'),
    sqlc.narg('reason'),
    sqlc.narg('client_ip')
FROM (SELECT 1) AS entry
    LEFT JOIN users actor ON actor.tenant_id = sqlc.arg('tenant_id')
    AND actor.id = sqlc.narg('actor_user_id')::uuid;

-- Platform ListAuditLogs is (created_at, id) DESC. Forward uses the DESC
-- query; backward uses ASC so the index can be scanned in reverse. The handler
-- flips ASC rows back into display order. A parameterized ORDER BY cannot be
-- read in index order, so each scan direction gets its own query.
-- The tenant is the one the entry was written for, which stays on the entry
-- after its target is deleted; an invitation entry still names the invited
-- address through the invitation's row.
-- cursor rules: proto/README.md.
-- name: ListPlatformAuditLogsDesc :many
SELECT a.id,
    a.actor_platform_user_id,
    a.actor_role,
    a.action,
    a.target_type,
    a.target_id,
    a.outcome,
    a.reason,
    a.client_ip,
    a.created_at,
    COALESCE(actor_pu.name, ''::text) AS actor_name,
    COALESCE(actor_pu.public_id, ''::text) AS actor_public_id,
    COALESCE(entry_t.name, ''::text) AS tenant_name,
    COALESCE(entry_t.public_id, ''::text) AS tenant_public_id,
    CASE
        WHEN a.target_type = 'tenant' THEN COALESCE(target_t.public_id, ''::text)
        WHEN a.target_type = 'operator' THEN COALESCE(target_pu.public_id, ''::text)
        WHEN a.target_type = 'user' THEN COALESCE(target_u.public_id, ''::text)
        ELSE ''::text
    END AS target_public_id,
    CASE
        WHEN a.target_type = 'tenant' THEN COALESCE(target_t.name, ''::text)
        WHEN a.target_type = 'operator' THEN COALESCE(target_pu.name, ''::text)
        WHEN a.target_type = 'user' THEN COALESCE(target_u.name, ''::text)
        WHEN a.target_type = 'tenant_admin_invitation' THEN COALESCE(target_inv.email::text, ''::text)
        ELSE ''::text
    END AS target_name
FROM platform_audit_logs a
    LEFT JOIN platform_users actor_pu ON actor_pu.id = a.actor_platform_user_id
    LEFT JOIN platform_users target_pu ON target_pu.id::text = a.target_id
    AND a.target_type = 'operator'
    LEFT JOIN users target_u ON target_u.id::text = a.target_id
    AND a.target_type = 'user'
    LEFT JOIN tenants target_t ON target_t.id::text = a.target_id
    AND a.target_type = 'tenant'
    LEFT JOIN tenant_admin_invitations target_inv ON target_inv.id::text = a.target_id
    AND a.target_type = 'tenant_admin_invitation'
    LEFT JOIN tenants entry_t ON entry_t.id = a.tenant_id
WHERE (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR actor_pu.public_id = sqlc.narg('filter_actor_user_public_id')::text)
    AND (sqlc.narg('filter_tenant_id')::uuid IS NULL OR a.tenant_id = sqlc.narg('filter_tenant_id')::uuid)
    AND (sqlc.narg('filter_action')::text IS NULL OR a.action = sqlc.narg('filter_action')::text)
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (a.created_at, a.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (a.created_at, a.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPlatformAuditLogsAsc :many
SELECT a.id,
    a.actor_platform_user_id,
    a.actor_role,
    a.action,
    a.target_type,
    a.target_id,
    a.outcome,
    a.reason,
    a.client_ip,
    a.created_at,
    COALESCE(actor_pu.name, ''::text) AS actor_name,
    COALESCE(actor_pu.public_id, ''::text) AS actor_public_id,
    COALESCE(entry_t.name, ''::text) AS tenant_name,
    COALESCE(entry_t.public_id, ''::text) AS tenant_public_id,
    CASE
        WHEN a.target_type = 'tenant' THEN COALESCE(target_t.public_id, ''::text)
        WHEN a.target_type = 'operator' THEN COALESCE(target_pu.public_id, ''::text)
        WHEN a.target_type = 'user' THEN COALESCE(target_u.public_id, ''::text)
        ELSE ''::text
    END AS target_public_id,
    CASE
        WHEN a.target_type = 'tenant' THEN COALESCE(target_t.name, ''::text)
        WHEN a.target_type = 'operator' THEN COALESCE(target_pu.name, ''::text)
        WHEN a.target_type = 'user' THEN COALESCE(target_u.name, ''::text)
        WHEN a.target_type = 'tenant_admin_invitation' THEN COALESCE(target_inv.email::text, ''::text)
        ELSE ''::text
    END AS target_name
FROM platform_audit_logs a
    LEFT JOIN platform_users actor_pu ON actor_pu.id = a.actor_platform_user_id
    LEFT JOIN platform_users target_pu ON target_pu.id::text = a.target_id
    AND a.target_type = 'operator'
    LEFT JOIN users target_u ON target_u.id::text = a.target_id
    AND a.target_type = 'user'
    LEFT JOIN tenants target_t ON target_t.id::text = a.target_id
    AND a.target_type = 'tenant'
    LEFT JOIN tenant_admin_invitations target_inv ON target_inv.id::text = a.target_id
    AND a.target_type = 'tenant_admin_invitation'
    LEFT JOIN tenants entry_t ON entry_t.id = a.tenant_id
WHERE (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR actor_pu.public_id = sqlc.narg('filter_actor_user_public_id')::text)
    AND (sqlc.narg('filter_tenant_id')::uuid IS NULL OR a.tenant_id = sqlc.narg('filter_tenant_id')::uuid)
    AND (sqlc.narg('filter_action')::text IS NULL OR a.action = sqlc.narg('filter_action')::text)
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (a.created_at, a.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (a.created_at, a.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY a.created_at ASC, a.id ASC
LIMIT sqlc.arg('limit');

-- Admin ListAuditLogs is (created_at, id) DESC. Forward uses the DESC query;
-- backward uses ASC so the index can be scanned in reverse. The handler flips
-- ASC rows back into display order. A parameterized ORDER BY cannot be read in
-- index order, so each scan direction gets its own query.
-- The actor is read through the account while it exists and from what the
-- entry kept of it once it is deleted, for the filter as for the columns, so a
-- deleted member's entries are still listed under their public ID.
-- cursor rules: proto/README.md.
-- name: ListAuditLogsByTenantDesc :many
SELECT a.id,
    a.tenant_id,
    a.actor_user_id,
    a.actor_role,
    a.action,
    a.target_type,
    a.target_id,
    a.outcome,
    a.reason,
    a.client_ip,
    a.created_at,
    COALESCE(actor_u.public_id, a.actor_public_id, ''::text) AS actor_public_id,
    COALESCE(actor_u.name, a.actor_name, ''::text) AS actor_name
FROM audit_logs a
    LEFT JOIN users actor_u ON actor_u.id = a.actor_user_id
WHERE a.tenant_id = sqlc.arg('tenant_id')
    AND (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR COALESCE(actor_u.public_id, a.actor_public_id) = sqlc.narg('filter_actor_user_public_id')::text)
    AND (sqlc.narg('filter_action')::text IS NULL OR a.action = sqlc.narg('filter_action')::text)
    AND (sqlc.narg('filter_created_from')::timestamptz IS NULL OR a.created_at >= sqlc.narg('filter_created_from')::timestamptz)
    AND (sqlc.narg('filter_created_to')::timestamptz IS NULL OR a.created_at < sqlc.narg('filter_created_to')::timestamptz)
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (a.created_at, a.id) <= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (a.created_at, a.id) < (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY a.created_at DESC, a.id DESC
LIMIT sqlc.arg('limit');

-- name: ListAuditLogsByTenantAsc :many
SELECT a.id,
    a.tenant_id,
    a.actor_user_id,
    a.actor_role,
    a.action,
    a.target_type,
    a.target_id,
    a.outcome,
    a.reason,
    a.client_ip,
    a.created_at,
    COALESCE(actor_u.public_id, a.actor_public_id, ''::text) AS actor_public_id,
    COALESCE(actor_u.name, a.actor_name, ''::text) AS actor_name
FROM audit_logs a
    LEFT JOIN users actor_u ON actor_u.id = a.actor_user_id
WHERE a.tenant_id = sqlc.arg('tenant_id')
    AND (sqlc.narg('filter_actor_user_public_id')::text IS NULL OR COALESCE(actor_u.public_id, a.actor_public_id) = sqlc.narg('filter_actor_user_public_id')::text)
    AND (sqlc.narg('filter_action')::text IS NULL OR a.action = sqlc.narg('filter_action')::text)
    AND (sqlc.narg('filter_created_from')::timestamptz IS NULL OR a.created_at >= sqlc.narg('filter_created_from')::timestamptz)
    AND (sqlc.narg('filter_created_to')::timestamptz IS NULL OR a.created_at < sqlc.narg('filter_created_to')::timestamptz)
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (a.created_at, a.id) >= (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (a.created_at, a.id) > (sqlc.narg('cursor_created_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY a.created_at ASC, a.id ASC
LIMIT sqlc.arg('limit');
