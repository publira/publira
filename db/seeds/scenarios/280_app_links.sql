-- Scenario: a tenant whose app link identities the E2E may save and clear
--
-- `admin.app-links.spec.ts` saves this tenant's Android and iOS app identities
-- from `/settings/app-links` and clears them again. They name the apps every
-- link to the tenant's site opens in, so no tenant another suite reads can
-- absorb them.
--
-- Applying it is also how the suite puts the tenant back: the tenant's config
-- row is deleted, which leaves it with no app on either platform.
-- public_id values are hard-coded in e2e/src/scenarios/app-links.ts.
--   tenant AplnTNNTAAA1 (app-links.localhost / admin.app-links.localhost)
--   admin  AplnADMNAAA1 (app-links-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f0fd0-0001-7000-8000-000000000001'::uuid AS id
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
    'AplnTNNTAAA1',
    'app-links.localhost',
    'admin.app-links.localhost',
    'App Links Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

\set seed_tenant AplnTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f0fd0-0002-7000-8000-000000000001'::uuid AS id
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
    'AplnADMNAAA1',
    'app-links-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'App Links E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'AplnTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0fd0-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'AplnADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM tenant_config
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'AplnTNNTAAA1');
