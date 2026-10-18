-- A purchase of a volume names no episode, so it cannot outlive the column
-- that names its volume, and it is a sale the tenant was paid for. Rather than
-- deleting it, the rollback refuses to run while one exists.
DO $$
BEGIN
    IF EXISTS (
            SELECT 1
            FROM purchases
            WHERE volume_id IS NOT NULL
        ) THEN RAISE EXCEPTION 'purchases of volumes exist; this migration cannot be rolled back without losing them';
    END IF;
END $$;

DROP VIEW volume_purchase_surfaces;

-- The view is put back as the rental migration left it before the tables it
-- now reads are dropped.
CREATE OR REPLACE VIEW episode_content_grants WITH (security_invoker = true) AS
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
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
    'access_ticket'::text AS kind,
    NULL::text AS purchase_kind
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
    'creator'::text AS kind,
    NULL::text AS purchase_kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_volume_id_fkey,
    DROP CONSTRAINT purchases_item_check,
    DROP COLUMN volume_id,
    ALTER COLUMN episode_id SET NOT NULL;

DROP TABLE expired_volume_checkouts;

ALTER TABLE ONLY volumes
    DROP CONSTRAINT volumes_tenant_cover_image_id_fkey;

DROP TABLE volume_cover_image_variants;

DROP TABLE volume_cover_images;

DROP TABLE volume_episodes;

DROP TABLE volumes;
