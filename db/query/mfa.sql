-- Admin MFA. Every statement is keyed by user_id alone: the row-level
-- security policies on both tables already confine them to the tenant the
-- connection is scoped to.

-- name: GetUserMfaTotpByUserID :one
SELECT *
FROM user_mfa_totp
WHERE user_id = $1;

-- name: UpsertUserMfaTotpSecret :one
-- Starting enrollment replaces whatever unconfirmed secret was there and
-- clears the lock, so a stalled attempt never blocks the next one.
INSERT INTO user_mfa_totp (user_id, tenant_id, secret_encrypted)
VALUES ($1, $2, $3)
ON CONFLICT (user_id) DO UPDATE
SET secret_encrypted = EXCLUDED.secret_encrypted,
    enabled_at = NULL,
    last_verified_step = NULL,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
RETURNING *;

-- name: EnableUserMfaTotp :one
-- last_verified_step is left alone: the code that confirmed the enrollment
-- was accepted through the same path a login code is, which stored it.
UPDATE user_mfa_totp
SET enabled_at = now(),
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE user_id = $1
RETURNING *;

-- name: MarkUserMfaTotpVerified :exec
UPDATE user_mfa_totp
SET last_verified_step = sqlc.arg('last_verified_step'),
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE user_id = sqlc.arg('user_id');

-- name: ResetUserMfaTotpFailures :exec
UPDATE user_mfa_totp
SET failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE user_id = $1;

-- name: RecordUserMfaTotpFailure :one
-- Reaching the threshold starts the lock and puts the counter back to zero,
-- so the attempt after a lock expires is not immediately the fifth again.
UPDATE user_mfa_totp
SET failed_attempts = CASE
        WHEN failed_attempts + 1 >= sqlc.arg('max_failed_attempts')::int THEN 0
        ELSE failed_attempts + 1
    END,
    locked_until = CASE
        WHEN failed_attempts + 1 >= sqlc.arg('max_failed_attempts')::int THEN sqlc.arg('locked_until')::timestamptz
        ELSE locked_until
    END,
    updated_at = now()
WHERE user_id = sqlc.arg('user_id')
RETURNING *;

-- name: DeleteUserMfaTotpByUserID :exec
DELETE FROM user_mfa_totp
WHERE user_id = $1;

-- name: CreateUserMfaRecoveryCode :exec
INSERT INTO user_mfa_recovery_codes (id, tenant_id, user_id, code_hash)
VALUES ($1, $2, $3, $4);

-- name: ListUnusedUserMfaRecoveryCodes :many
SELECT id, code_hash
FROM user_mfa_recovery_codes
WHERE user_id = $1
    AND used_at IS NULL
ORDER BY created_at, id;

-- name: CountUnusedUserMfaRecoveryCodes :one
SELECT count(*)
FROM user_mfa_recovery_codes
WHERE user_id = $1
    AND used_at IS NULL;

-- name: MarkUserMfaRecoveryCodeUsed :execrows
UPDATE user_mfa_recovery_codes
SET used_at = now()
WHERE id = $1
    AND used_at IS NULL;

-- name: DeleteUserMfaRecoveryCodesByUserID :exec
DELETE FROM user_mfa_recovery_codes
WHERE user_id = $1;
