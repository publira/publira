-- name: GetUserIdentityByProviderSubject :one
SELECT *
FROM user_identities
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND subject = sqlc.arg('subject');

-- name: GetUserIdentityForUser :one
SELECT *
FROM user_identities
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND provider = sqlc.arg('provider');

-- name: CreateUserIdentity :one
INSERT INTO user_identities (
        id,
        tenant_id,
        user_id,
        provider,
        subject,
        email_at_link
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('user_id'),
        sqlc.arg('provider'),
        sqlc.arg('subject'),
        sqlc.arg('email_at_link')
    )
RETURNING *;

-- name: ListUserIdentitiesForUser :many
SELECT *
FROM user_identities
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
ORDER BY provider;

-- name: DeleteUserIdentityForUser :one
DELETE FROM user_identities
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND provider = sqlc.arg('provider')
RETURNING *;

-- name: SetUserIdentityRefreshToken :execrows
-- Stores the refresh token an authorization code was exchanged for. No row is
-- updated when the link went away while the code was being exchanged, or holds
-- a token already, and the caller revokes the one it got instead.
UPDATE user_identities
SET refresh_token_encrypted = sqlc.arg('refresh_token_encrypted'),
    refresh_token_client_id = sqlc.arg('refresh_token_client_id')
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND refresh_token_encrypted IS NULL;
