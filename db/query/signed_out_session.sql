-- name: RecordUserSessionSignedOut :exec
-- Signing out twice with the same token records it once.
INSERT INTO user_signed_out_sessions (jti, tenant_id, user_id, expires_at)
VALUES ($1, $2, $3, $4)
ON CONFLICT (jti) DO NOTHING;

-- name: UserSessionSignedOut :one
SELECT EXISTS (
    SELECT 1
    FROM user_signed_out_sessions
    WHERE jti = $1
);

-- name: RecordPlatformUserSessionSignedOut :exec
-- Signing out twice with the same token records it once.
INSERT INTO platform_user_signed_out_sessions (jti, platform_user_id, expires_at)
VALUES ($1, $2, $3)
ON CONFLICT (jti) DO NOTHING;

-- name: PlatformUserSessionSignedOut :one
SELECT EXISTS (
    SELECT 1
    FROM platform_user_signed_out_sessions
    WHERE jti = $1
);
