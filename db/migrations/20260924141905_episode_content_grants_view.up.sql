-- VIEW: episode_content_grants
-- The grants that open a priced episode to one reader right now: a purchase
-- neither refunded nor past its reading period, and an access ticket neither
-- revoked nor expired. A deleted buyer's purchase keeps a NULL user_id, which
-- matches no reader.
--
-- security_invoker keeps the row-level security of purchases and
-- access_tickets the caller's own; without it the view would run with the
-- rights of the role that applies migrations, which bypasses RLS.
CREATE VIEW episode_content_grants WITH (security_invoker = true) AS
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
