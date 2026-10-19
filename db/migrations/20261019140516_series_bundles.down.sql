-- A purchase of a bundle names no episode, so it cannot outlive the column
-- that names its bundle, and it is a sale the tenant was paid for. Rather than
-- deleting it, the rollback refuses to run while one exists.
DO $$
BEGIN
    IF EXISTS (
            SELECT 1
            FROM purchases
            WHERE series_bundle_id IS NOT NULL
        ) THEN RAISE EXCEPTION 'purchases of series bundles exist; this migration cannot be rolled back without losing them';
    END IF;
END $$;

-- The view is put back as the volumes migration left it before the tables it
-- now reads are dropped.
CREATE OR REPLACE VIEW episode_content_grants WITH (security_invoker = true) AS
SELECT at.tenant_id,
    at.user_id,
    at.episode_id,
    'access_ticket'::text AS kind,
    NULL::text AS purchase_kind
FROM access_tickets at
WHERE at.revoked_at IS NULL
    AND (
        at.expires_at IS NULL
        OR at.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
WHERE p.episode_id IS NOT NULL
    AND p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    ve.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN volume_episodes ve ON ve.tenant_id = p.tenant_id
    AND ve.volume_id = p.volume_id
WHERE p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT ec.tenant_id,
    ca.user_id,
    ec.episode_id,
    'creator'::text AS kind,
    NULL::text AS purchase_kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id;

-- The CHECK goes back as the volumes validation migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_series_bundle_id_fkey,
    DROP CONSTRAINT purchases_item_check,
    DROP COLUMN series_bundle_id,
    ADD CONSTRAINT purchases_item_check CHECK ((((episode_id IS NULL) <> (volume_id IS NULL)) AND ((volume_id IS NULL) OR ((kind = 'purchase'::text) AND (store IS NULL)))));

DROP TABLE series_bundle_episodes;

DROP TABLE series_bundles;

ALTER TABLE ONLY series_listings
    DROP CONSTRAINT series_listings_bundle_discount_percent_check,
    DROP COLUMN bundle_discount_percent;
