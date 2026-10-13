-- The signed keys of inbound email deliveries whose signature does not cover
-- the mail, and the digest of the mail each first arrived with.
--
-- Expected plans:
--   ClaimInboundEmailReplayKey, GetInboundEmailReplayKeyContent -> inbound_email_replay_keys_pkey
--   DeleteInboundEmailReplayKeysReceivedBefore -> idx_inbound_email_replay_keys_tenant_received_at

-- name: ClaimInboundEmailReplayKey :execrows
INSERT INTO inbound_email_replay_keys (
    tenant_id,
    provider,
    replay_key,
    content_sha256
) VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('provider'),
    sqlc.arg('replay_key'),
    sqlc.arg('content_sha256')
)
ON CONFLICT (provider, replay_key) DO NOTHING;

-- name: GetInboundEmailReplayKeyContent :one
SELECT content_sha256
FROM inbound_email_replay_keys
WHERE tenant_id = sqlc.arg('tenant_id')
    AND provider = sqlc.arg('provider')
    AND replay_key = sqlc.arg('replay_key');

-- name: DeleteInboundEmailReplayKeysReceivedBefore :exec
DELETE FROM inbound_email_replay_keys
WHERE tenant_id = sqlc.arg('tenant_id')
    AND received_at < sqlc.arg('received_before');
