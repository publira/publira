-- WebAuthn ceremonies between their begin and their finish.

-- name: LockUserWebauthnCeremonies :exec
-- Serialises the begins of one account's ceremonies of one kind for the rest
-- of the transaction. StartUserWebauthnCeremony counts what is open and adds to
-- it in one statement, and two of those running at once would each count from
-- the same snapshot and both stay within the cap they then exceed together.
SELECT pg_advisory_xact_lock(
    hashtextextended(
        'user_webauthn_ceremonies:' || sqlc.arg('user_id')::uuid::text || ':' || sqlc.arg('ceremony')::text,
        0
    )
);

-- name: StartUserWebauthnCeremony :exec
-- Ceremonies of one account run side by side, so a second tab or device does
-- not void the first. Beginning one drops the account's expired ceremonies of
-- the same kind and all but the newest that, with this one, make up
-- max_open, which bounds what a caller who keeps calling a begin can leave in
-- the table.
-- The caller holds LockUserWebauthnCeremonies, so the open ceremonies this
-- counts are the ones there are.
WITH abandoned AS (
    DELETE FROM user_webauthn_ceremonies
    WHERE user_webauthn_ceremonies.challenge IN (
            SELECT c.challenge
            FROM user_webauthn_ceremonies c
            WHERE c.user_id = sqlc.arg('user_id')
                AND c.ceremony = sqlc.arg('ceremony')
            ORDER BY c.created_at DESC,
                c.challenge
            OFFSET sqlc.arg('max_open')::int - 1
        )
        OR (
            user_webauthn_ceremonies.user_id = sqlc.arg('user_id')
            AND user_webauthn_ceremonies.ceremony = sqlc.arg('ceremony')
            AND user_webauthn_ceremonies.expires_at < now()
        )
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
