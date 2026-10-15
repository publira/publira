-- WebAuthn credentials. Every statement is keyed by the user, and the
-- row-level security policy confines it to the tenant the connection is scoped
-- to. A credential answers only the relying party ID it was registered for,
-- so every read that offers credentials to a ceremony names that RP ID too.

-- name: CreateUserWebauthnCredential :one
INSERT INTO user_webauthn_credentials (
        id,
        public_id,
        tenant_id,
        user_id,
        rp_id,
        credential_id,
        public_key,
        sign_count,
        aaguid,
        transports,
        backup_eligible,
        backed_up,
        name
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('public_id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('user_id'),
        sqlc.arg('rp_id'),
        sqlc.arg('credential_id'),
        sqlc.arg('public_key'),
        sqlc.arg('sign_count'),
        sqlc.arg('aaguid'),
        sqlc.arg('transports')::text[],
        sqlc.arg('backup_eligible'),
        sqlc.arg('backed_up'),
        sqlc.arg('name')
    )
RETURNING *;

-- name: ListUserWebauthnCredentialsForRPID :many
SELECT *
FROM user_webauthn_credentials
WHERE user_id = sqlc.arg('user_id')
    AND rp_id = sqlc.arg('rp_id')
ORDER BY created_at,
    id;

-- name: CountUserWebauthnCredentialsForRPID :one
SELECT count(*)
FROM user_webauthn_credentials
WHERE user_id = sqlc.arg('user_id')
    AND rp_id = sqlc.arg('rp_id');

-- name: LockUserWebauthnCredentialsForRPID :many
-- Taken before removing one of them, so two removals racing over an
-- account's last two credentials see each other's delete before counting
-- what is left, rather than each counting the other's row as still there.
SELECT id
FROM user_webauthn_credentials
WHERE user_id = sqlc.arg('user_id')
    AND rp_id = sqlc.arg('rp_id')
ORDER BY id
FOR UPDATE;

-- name: GetUserWebauthnCredentialByPublicID :one
SELECT *
FROM user_webauthn_credentials
WHERE user_id = sqlc.arg('user_id')
    AND rp_id = sqlc.arg('rp_id')
    AND public_id = sqlc.arg('public_id');

-- name: MarkUserWebauthnCredentialUsed :execrows
-- The counter predicate is the clone check, not a repeat of one already made
-- in Go: two assertions carrying the same counter can both pass the check
-- against the row they read, and Postgres re-evaluates this WHERE against the
-- row the first one committed, so the second updates nothing and its caller
-- refuses the assertion. An authenticator that keeps no counter reports zero
-- each time, which stays acceptable for as long as the stored counter is zero
-- too. Affecting no row is therefore a counter that did not move forward.
UPDATE user_webauthn_credentials
SET sign_count = sqlc.arg('sign_count'),
    backed_up = sqlc.arg('backed_up'),
    last_used_at = now()
WHERE id = sqlc.arg('id')
    AND (
        sign_count < sqlc.arg('sign_count')
        OR (
            sign_count = 0
            AND sqlc.arg('sign_count') = 0
        )
    );

-- name: RenameUserWebauthnCredential :one
UPDATE user_webauthn_credentials
SET name = sqlc.arg('name')
WHERE id = sqlc.arg('id')
RETURNING *;

-- name: DeleteUserWebauthnCredential :execrows
DELETE FROM user_webauthn_credentials
WHERE id = sqlc.arg('id');

-- name: DeleteUserWebauthnCredentialsByUserID :execrows
-- Every RP ID, not only the one the console derives now: a credential
-- registered while the console was served on another host is dormant rather
-- than gone, and moving the console back would let it sign in again.
DELETE FROM user_webauthn_credentials
WHERE user_id = sqlc.arg('user_id');
