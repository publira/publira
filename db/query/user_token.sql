-- name: CreateUserEmailVerificationToken :one
INSERT INTO user_email_verification_tokens (
        id,
        tenant_id,
        user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: CreateUserEmailChangeToken :one
INSERT INTO user_email_change_tokens (
        id,
        tenant_id,
        user_id,
        current_email,
        new_email,
        current_email_token_hash,
        new_email_token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: CreateUserPasswordResetToken :one
INSERT INTO user_password_reset_tokens (
        id,
        tenant_id,
        user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5)
RETURNING *;

-- name: DeleteUserEmailChangeTokensByUserID :exec
DELETE FROM user_email_change_tokens
WHERE user_id = $1
    AND completed_at IS NULL;

-- name: DeleteUserPasswordResetTokensByUserID :exec
DELETE FROM user_password_reset_tokens
WHERE user_id = $1
    AND completed_at IS NULL;

-- name: GetUserEmailVerificationTokenByHashForTenant :one
SELECT *
FROM user_email_verification_tokens
WHERE tenant_id = $1
    AND token_hash = $2
LIMIT 1;

-- name: GetUserEmailChangeTokenByHashForTenant :one
SELECT *,
    CASE
        WHEN current_email_token_hash = $2 THEN 'current_email'::text
        ELSE 'new_email'::text
    END AS matched_target
FROM user_email_change_tokens
WHERE tenant_id = $1
    AND (
        current_email_token_hash = $2
        OR new_email_token_hash = $2
    )
LIMIT 1;

-- name: GetUserPasswordResetTokenByHashForTenant :one
SELECT *
FROM user_password_reset_tokens
WHERE tenant_id = $1
    AND token_hash = $2
LIMIT 1;

-- name: MarkUserEmailVerificationTokenUsed :exec
UPDATE user_email_verification_tokens
SET used_at = NOW()
WHERE id = $1
    AND used_at IS NULL;

-- name: MarkUserEmailChangeCurrentEmailConfirmed :exec
UPDATE user_email_change_tokens
SET current_email_confirmed_at = COALESCE(current_email_confirmed_at, NOW())
WHERE id = $1;

-- name: MarkUserEmailChangeNewEmailConfirmed :exec
UPDATE user_email_change_tokens
SET new_email_confirmed_at = COALESCE(new_email_confirmed_at, NOW())
WHERE id = $1;

-- name: MarkUserEmailChangeCompleted :exec
UPDATE user_email_change_tokens
SET completed_at = COALESCE(completed_at, NOW())
WHERE id = $1;

-- name: MarkUserPasswordResetTokenCompleted :exec
UPDATE user_password_reset_tokens
SET completed_at = COALESCE(completed_at, NOW())
WHERE id = $1;
