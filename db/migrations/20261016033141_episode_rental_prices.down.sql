-- CREATE OR REPLACE VIEW cannot drop a column, so the view is recreated as the
-- previous migration left it. reader_may_open_episode names it only inside its
-- body, which PostgreSQL does not record as a dependency.
DROP VIEW episode_content_grants;

CREATE VIEW episode_content_grants WITH (security_invoker = true) AS
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

ALTER TABLE ONLY purchases
    DROP COLUMN kind;

ALTER TABLE ONLY series_listings
    DROP COLUMN rental_period_hours;

ALTER TABLE ONLY episode_listings
    DROP COLUMN rental_period_hours,
    DROP COLUMN rental_price;
