-- WebAuthn ceremonies between their begin and their finish.

-- name: StartUserWebauthnCeremony :exec
-- Beginning a ceremony replaces any of the same kind the account left
-- unfinished, so the table holds at most one per account and kind however
-- often a begin is called.
WITH abandoned AS (
    DELETE FROM user_webauthn_ceremonies
    WHERE user_webauthn_ceremonies.user_id = sqlc.arg('user_id')
        AND user_webauthn_ceremonies.ceremony = sqlc.arg('ceremony')
)
INSERT INTO user_webauthn_ceremonies (
        challenge,
        tenant_id,
        user_id,
        ceremony,
        rp_id,
        expires_at
    )
VALUES (
        sqlc.arg('challenge'),
        sqlc.arg('tenant_id'),
        sqlc.arg('user_id'),
        sqlc.arg('ceremony'),
        sqlc.arg('rp_id'),
        sqlc.arg('expires_at')
    );

-- name: SpendUserWebauthnCeremony :one
-- The DELETE is the claim on the ceremony: two finishes presenting the same
-- challenge both look for it, and only the one whose delete returns the row
-- may verify against it. A ceremony is spent whatever the verification then
-- answers, so a refused response cannot be retried against the same challenge.
DELETE FROM user_webauthn_ceremonies
WHERE challenge = sqlc.arg('challenge')
    AND user_id = sqlc.arg('user_id')
    AND ceremony = sqlc.arg('ceremony')
RETURNING *;
