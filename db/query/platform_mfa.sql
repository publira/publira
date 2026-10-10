-- Platform operator MFA. The statements mirror the tenant staff's in mfa.sql,
-- keyed by platform_user_id instead of a tenant's user_id.

-- name: GetPlatformUserMfaTotp :one
SELECT *
FROM platform_user_mfa_totp
WHERE platform_user_id = $1;

-- name: UpsertPlatformUserMfaTotpSecret :one
-- Starting enrollment replaces whatever unconfirmed secret was there and
-- clears the lock, so a stalled attempt never blocks the next one.
INSERT INTO platform_user_mfa_totp (platform_user_id, secret_encrypted)
VALUES ($1, $2)
ON CONFLICT (platform_user_id) DO UPDATE
SET secret_encrypted = EXCLUDED.secret_encrypted,
    enabled_at = NULL,
    last_verified_step = NULL,
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
RETURNING *;

-- name: EnablePlatformUserMfaTotp :one
-- last_verified_step is left alone: the code that confirmed the enrollment
-- was accepted through the same path a sign-in code is, which stored it.
UPDATE platform_user_mfa_totp
SET enabled_at = now(),
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE platform_user_id = $1
RETURNING *;

-- name: MarkPlatformUserMfaTotpVerified :execrows
-- The step predicate is the replay check: two requests carrying the same code
-- can both read the old step before either writes, and Postgres re-evaluates
-- this WHERE against the row the first one committed, so the second updates
-- nothing. Affecting no row is therefore a reused code, not a missing operator.
UPDATE platform_user_mfa_totp
SET last_verified_step = sqlc.arg('last_verified_step'),
    failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE platform_user_id = sqlc.arg('platform_user_id')
    AND (
        last_verified_step IS NULL
        OR last_verified_step < sqlc.arg('last_verified_step')
    );

-- name: ResetPlatformUserMfaTotpFailures :exec
UPDATE platform_user_mfa_totp
SET failed_attempts = 0,
    locked_until = NULL,
    updated_at = now()
WHERE platform_user_id = $1;

-- name: RecordPlatformUserMfaTotpFailure :one
-- Reaching the threshold starts the lock and puts the counter back to zero,
-- so the attempt after a lock expires is not immediately the fifth again.
UPDATE platform_user_mfa_totp
SET failed_attempts = CASE
        WHEN failed_attempts + 1 >= sqlc.arg('max_failed_attempts')::int THEN 0
        ELSE failed_attempts + 1
    END,
    locked_until = CASE
        WHEN failed_attempts + 1 >= sqlc.arg('max_failed_attempts')::int THEN sqlc.arg('locked_until')::timestamptz
        ELSE locked_until
    END,
    updated_at = now()
WHERE platform_user_id = sqlc.arg('platform_user_id')
RETURNING *;

-- name: DeletePlatformUserMfaTotp :exec
DELETE FROM platform_user_mfa_totp
WHERE platform_user_id = $1;

-- name: CreatePlatformUserMfaRecoveryCode :exec
INSERT INTO platform_user_mfa_recovery_codes (id, platform_user_id, code_hash)
VALUES ($1, $2, $3);

-- name: ListUnusedPlatformUserMfaRecoveryCodes :many
SELECT id, code_hash
FROM platform_user_mfa_recovery_codes
WHERE platform_user_id = $1
    AND used_at IS NULL
ORDER BY created_at, id;

-- name: CountUnusedPlatformUserMfaRecoveryCodes :one
SELECT count(*)
FROM platform_user_mfa_recovery_codes
WHERE platform_user_id = $1
    AND used_at IS NULL;

-- name: MarkPlatformUserMfaRecoveryCodeUsed :execrows
UPDATE platform_user_mfa_recovery_codes
SET used_at = now()
WHERE id = $1
    AND used_at IS NULL;

-- name: DeletePlatformUserMfaRecoveryCodes :exec
DELETE FROM platform_user_mfa_recovery_codes
WHERE platform_user_id = $1;

-- name: MarkPlatformUserMfaChallengeUsed :execrows
-- The INSERT is the claim on the challenge rather than a lookup followed by
-- one: two requests presenting the same token both find it unspent, and only
-- the one whose row lands may exchange it. Affecting no row is therefore a
-- challenge that has already bought a session.
INSERT INTO platform_user_mfa_used_challenges (jti, platform_user_id, expires_at)
VALUES ($1, $2, $3)
ON CONFLICT (jti) DO NOTHING;
