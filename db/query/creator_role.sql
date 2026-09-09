-- The role list is read in the order the tenant put it in, so the cursor sorts
-- on (display_priority, id) — the same pair
-- idx_creator_roles_tenant_display_priority holds. Forward uses the ascending
-- query; backward uses the descending one so the index is scanned in reverse,
-- and the handler flips those rows back into priority order.
-- cursor rules: proto/README.md.
-- name: ListCreatorRolesByTenantAsc :many
SELECT cr.id,
    cr.public_id,
    cr.name,
    cr.display_priority,
    cr.created_at
FROM creator_roles cr
WHERE cr.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (cr.display_priority, cr.id) >= (sqlc.narg('cursor_display_priority')::int4, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (cr.display_priority, cr.id) > (sqlc.narg('cursor_display_priority')::int4, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY cr.display_priority ASC,
    cr.id ASC
LIMIT sqlc.arg('limit');

-- name: ListCreatorRolesByTenantDesc :many
SELECT cr.id,
    cr.public_id,
    cr.name,
    cr.display_priority,
    cr.created_at
FROM creator_roles cr
WHERE cr.tenant_id = sqlc.arg('tenant_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (cr.display_priority, cr.id) <= (sqlc.narg('cursor_display_priority')::int4, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (cr.display_priority, cr.id) < (sqlc.narg('cursor_display_priority')::int4, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY cr.display_priority DESC,
    cr.id DESC
LIMIT sqlc.arg('limit');

-- name: GetCreatorRoleByPublicIDForTenant :one
SELECT cr.id,
    cr.public_id,
    cr.name,
    cr.display_priority
FROM creator_roles cr
WHERE cr.tenant_id = $1
    AND cr.public_id = $2
LIMIT 1;

-- name: ListCreatorRolesByPublicIDsForTenant :many
-- Resolves the roles a series form credited creators in. The caller compares
-- the row count against what it asked for, so a public_id of another tenant
-- reads as a role that does not exist.
SELECT cr.id,
    cr.public_id,
    cr.name,
    cr.display_priority
FROM creator_roles cr
WHERE cr.tenant_id = sqlc.arg('tenant_id')
    AND cr.public_id = ANY(sqlc.arg('public_ids')::text[])
ORDER BY cr.display_priority ASC,
    cr.id ASC;

-- name: LockCreatorRolesForTenant :many
-- Locks every role of the tenant and hands back the order they are in now, so
-- a reorder can check the client's expected order against a list no concurrent
-- write can move underneath it. The names come along because a reorder answers
-- with the whole list, and nothing in this transaction changes them.
SELECT id,
    public_id,
    name
FROM creator_roles
WHERE tenant_id = $1
ORDER BY display_priority ASC,
    id ASC
FOR UPDATE;

-- name: GetMaxCreatorRoleDisplayPriorityForTenant :one
-- Where a newly created role goes: after everything that already exists.
SELECT COALESCE(MAX(display_priority), 0)::int4 AS max_display_priority
FROM creator_roles
WHERE tenant_id = $1;

-- name: CountSeriesCreatorsByRoleIDForTenant :one
-- Whether a role may still be deleted. The refusal is the handler's, and this
-- is what it is based on.
SELECT COUNT(*)::int4 AS credit_count
FROM series_creators
WHERE tenant_id = sqlc.arg('tenant_id')
    AND role_id = sqlc.arg('role_id')::uuid;

-- name: CreateCreatorRole :one
INSERT INTO creator_roles (
        id,
        tenant_id,
        public_id,
        name,
        display_priority
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: UpdateCreatorRole :exec
UPDATE creator_roles
SET name = $2
WHERE id = $1;

-- name: UpdateCreatorRoleDisplayPriority :exec
UPDATE creator_roles
SET display_priority = $2
WHERE id = $1;

-- name: DeleteCreatorRole :exec
DELETE FROM creator_roles
WHERE id = $1;
