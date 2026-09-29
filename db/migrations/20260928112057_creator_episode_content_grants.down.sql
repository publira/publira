CREATE OR REPLACE VIEW episode_content_grants WITH (security_invoker = true) AS
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind
FROM purchases p
WHERE p.refunded_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT at.tenant_id,
    at.user_id,
    at.episode_id,
    'access_ticket'::text AS kind
FROM access_tickets at
WHERE at.revoked_at IS NULL
    AND (
        at.expires_at IS NULL
        OR at.expires_at > NOW()
    );
