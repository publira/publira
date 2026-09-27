-- name: ListCreatorAccountsByCreatorID :many
-- The accounts linked to one creator, oldest link first. The account columns
-- are the ones GetTenantReaderByID selects, less the birth date.
SELECT u.id,
    u.public_id,
    u.name,
    u.email,
    u.status,
    u.created_at,
    u.email_verified_at,
    ca.created_at AS linked_at
FROM creator_accounts ca
    JOIN users u ON u.id = ca.user_id
WHERE ca.tenant_id = sqlc.arg('tenant_id')
    AND ca.creator_id = sqlc.arg('creator_id')
ORDER BY ca.created_at ASC,
    u.id ASC;

-- name: CreateCreatorAccount :execrows
-- A pair that is already linked is no row, so a retried link records nothing.
INSERT INTO creator_accounts (tenant_id, creator_id, user_id)
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('creator_id'),
        sqlc.arg('user_id')
    ) ON CONFLICT (creator_id, user_id) DO NOTHING;

-- name: DeleteCreatorAccount :one
-- A pair that is not linked is no rows. The account's public_id is what the
-- audit entry names it by.
WITH deleted AS (
    DELETE FROM creator_accounts
    WHERE creator_accounts.tenant_id = sqlc.arg('tenant_id')
        AND creator_accounts.creator_id = sqlc.arg('creator_id')
        AND creator_accounts.user_id = sqlc.arg('user_id')
    RETURNING creator_accounts.user_id
)
SELECT u.public_id
FROM deleted
    JOIN users u ON u.id = deleted.user_id;
