-- VIEW: episode_content_grants
-- Adds the creator grant: an account linked to a creator the episode credits
-- opens that episode. It follows episode_creators rather than
-- series_creators, so a credit only the series carries grants nothing and the
-- grant always agrees with the credit line the episode prints.
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
    )
UNION ALL
SELECT ec.tenant_id,
    ca.user_id,
    ec.episode_id,
    'creator'::text AS kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id;
