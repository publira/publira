-- CONSTRAINT: purchases purchases_revocation_reason_check
-- CONSTRAINT: purchases purchases_refund_revokes_check
-- VALIDATE takes a SHARE UPDATE EXCLUSIVE lock, under which reads and writes of
-- purchases go on while the rows already there are checked.
ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_revocation_reason_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_refund_revokes_check;

-- VIEW: episode_content_grants
-- A purchase is a grant until it is revoked, whatever revoked it. A full
-- refund revokes it too, which purchases_refund_revokes_check guarantees, so
-- refunded_at no longer needs reading here.
CREATE OR REPLACE VIEW episode_content_grants WITH (security_invoker = true) AS
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind
FROM purchases p
WHERE p.revoked_at IS NULL
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
