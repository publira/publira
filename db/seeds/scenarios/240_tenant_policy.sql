-- Scenario: a tenant whose own community limits and retention periods the E2E may rewrite
--
-- `admin.tenant-policy.spec.ts` saves this tenant's community limits and
-- retention periods from `/settings/policy`. Both are tenant-wide, so no tenant
-- another suite reads a storefront on can absorb them.
--
-- Applying it is also how the suite puts the settings back: both override rows
-- are deleted, which returns every value to the platform default.
-- public_id values are hard-coded in e2e/src/scenarios/tenant-policy.ts.
--   tenant PlcyTNNTAAA1 (policy.localhost / admin.policy.localhost)
--   admin  PlcyADMNAAA1 (policy-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f0f50-0010-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale
)
SELECT
    ts.id,
    'PlcyTNNTAAA1',
    'policy.localhost',
    'admin.policy.localhost',
    'Policy Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

\set seed_tenant PlcyTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f0f50-0011-7000-8000-000000000001'::uuid AS id
)
INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    email_verified_at
)
SELECT
    aus.id,
    t.id,
    'PlcyADMNAAA1',
    'policy-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Policy Settings E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'PlcyTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0f50-0012-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'PlcyADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

-- Back to a tenant that has saved nothing: every value follows the platform
-- default, and the next save is the first one, at revision zero.
DELETE FROM tenant_community_limit_overrides
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PlcyTNNTAAA1');

DELETE FROM tenant_retention_settings
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PlcyTNNTAAA1');
