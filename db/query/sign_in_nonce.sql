-- name: SpendSignInNonce :execrows
-- Records a nonce as spent until the verifier stops accepting the token it
-- came with. No row is
-- inserted when the nonce was spent already, which is a replay. The tenant's
-- expired nonces are dropped in the same statement, so the table holds only
-- what can still be replayed.
WITH expired AS (
    DELETE FROM sign_in_nonces
    WHERE sign_in_nonces.tenant_id = sqlc.arg('tenant_id')
        AND sign_in_nonces.expires_at < NOW()
)
INSERT INTO sign_in_nonces (tenant_id, nonce_hash, expires_at)
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('nonce_hash'),
        sqlc.arg('expires_at')
    ) ON CONFLICT (tenant_id, nonce_hash) DO NOTHING;

-- name: SignInNonceIsSpent :one
-- Answers whether a nonce was spent already, without spending it, so a replay
-- can be refused before anything is charged for the request.
SELECT EXISTS (
    SELECT 1
    FROM sign_in_nonces
    WHERE sign_in_nonces.tenant_id = sqlc.arg('tenant_id')
        AND sign_in_nonces.nonce_hash = sqlc.arg('nonce_hash')
);
