-- name: CreateTenantApiKey :one
INSERT INTO tenant_api_keys (
        id,
        tenant_id,
        name,
        prefix,
        key_hash,
        scopes,
        created_by_user_id
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('name'),
        sqlc.arg('prefix'),
        sqlc.arg('key_hash'),
        sqlc.arg('scopes')::text [],
        sqlc.narg('created_by_user_id')
    )
RETURNING *;

-- name: ListTenantApiKeys :many
-- Every key of the tenant's, revoked ones included, newest first. A tenant
-- keeps few, so the list is not paged.
SELECT *
FROM tenant_api_keys
WHERE tenant_id = sqlc.arg('tenant_id')
ORDER BY created_at DESC,
    id DESC;

-- name: GetTenantApiKeyByPrefix :one
-- The key a request's bearer token names, revoked or not, so a revoked key is
-- told apart from one that never existed only in the log.
SELECT *
FROM tenant_api_keys
WHERE tenant_id = sqlc.arg('tenant_id')
    AND prefix = sqlc.arg('prefix');

-- name: RevokeTenantApiKey :one
-- Revokes a key that is not revoked yet; no row for one that is, or for none.
UPDATE tenant_api_keys
SET revoked_at = now()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND revoked_at IS NULL
RETURNING *;

-- name: GetTenantApiKey :one
SELECT *
FROM tenant_api_keys
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: TouchTenantApiKey :exec
-- Records that a key was used, at most once a minute, so a busy key does not
-- write on every request.
UPDATE tenant_api_keys
SET last_used_at = now()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND (
        last_used_at IS NULL
        OR last_used_at < now() - interval '1 minute'
    );
