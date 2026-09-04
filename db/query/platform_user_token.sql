-- name: CreatePlatformUserPasswordResetToken :one
INSERT INTO platform_user_password_reset_tokens (
        id,
        platform_user_id,
        token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: CreatePlatformUserEmailChangeToken :one
INSERT INTO platform_user_email_change_tokens (
        id,
        platform_user_id,
        current_email,
        new_email,
        current_email_token_hash,
        new_email_token_hash,
        expires_at
    )
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: DeletePlatformUserPasswordResetTokensByUserID :exec
DELETE FROM platform_user_password_reset_tokens
WHERE platform_user_id = $1
    AND completed_at IS NULL;

-- name: DeletePlatformUserEmailChangeTokensByUserID :exec
DELETE FROM platform_user_email_change_tokens
WHERE platform_user_id = $1
    AND completed_at IS NULL;

-- name: GetPlatformUserPasswordResetTokenByHash :one
SELECT *
FROM platform_user_password_reset_tokens
WHERE token_hash = $1
LIMIT 1;

-- name: GetPlatformUserEmailChangeTokenByHash :one
SELECT *,
    CASE
        WHEN current_email_token_hash = $1 THEN 'current_email'::text
        ELSE 'new_email'::text
    END AS matched_target
FROM platform_user_email_change_tokens
WHERE current_email_token_hash = $1
    OR new_email_token_hash = $1
LIMIT 1;

-- name: GetPlatformUserEmailChangeTokenByID :one
SELECT *
FROM platform_user_email_change_tokens
WHERE id = $1
LIMIT 1;

-- name: MarkPlatformUserPasswordResetTokenCompleted :exec
UPDATE platform_user_password_reset_tokens
SET completed_at = COALESCE(completed_at, NOW())
WHERE id = $1;

-- name: MarkPlatformUserEmailChangeCurrentEmailConfirmed :exec
UPDATE platform_user_email_change_tokens
SET current_email_confirmed_at = COALESCE(current_email_confirmed_at, NOW())
WHERE id = $1;

-- name: MarkPlatformUserEmailChangeNewEmailConfirmed :exec
UPDATE platform_user_email_change_tokens
SET new_email_confirmed_at = COALESCE(new_email_confirmed_at, NOW())
WHERE id = $1;

-- name: MarkPlatformUserEmailChangeCompleted :exec
UPDATE platform_user_email_change_tokens
SET completed_at = COALESCE(completed_at, NOW())
WHERE id = $1;
