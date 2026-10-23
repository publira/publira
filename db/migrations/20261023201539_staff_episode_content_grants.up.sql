-- VIEW: episode_content_grants
-- Adds the staff grant: an account holding a tenant staff role opens every
-- episode of the tenant, so staff can read their catalogue on the storefront
-- as a reader does. The arm names the three staff roles rather than reading
-- any row of tenant_user_roles, because the column has no CHECK constraint and
-- auth.IsTenantStaff recognises exactly these three: a stray value in it must
-- not open the catalogue. Publication stays the reader paths' own check, as it
-- is for every other arm.
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
SELECT p.tenant_id,
    p.user_id,
    sbe.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN series_bundle_episodes sbe ON sbe.tenant_id = p.tenant_id
    AND sbe.series_bundle_id = p.series_bundle_id
WHERE p.revoked_at IS NULL
    AND (
        sbe.reading_period_hours IS NULL
        OR p.purchased_at + make_interval(hours => sbe.reading_period_hours) > NOW()
    )
UNION ALL
SELECT ec.tenant_id,
    ca.user_id,
    ec.episode_id,
    'creator'::text AS kind,
    NULL::text AS purchase_kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id
UNION ALL
SELECT tur.tenant_id,
    tur.user_id,
    e.id AS episode_id,
    'staff'::text AS kind,
    NULL::text AS purchase_kind
FROM tenant_user_roles tur
    JOIN episodes e ON e.tenant_id = tur.tenant_id
WHERE tur.role IN ('tenant_admin', 'tenant_editor', 'tenant_auditor');
