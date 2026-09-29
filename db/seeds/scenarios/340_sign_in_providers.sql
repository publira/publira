-- Scenario: a tenant whose sign-in providers the E2E may switch on and off
--
-- `admin.sign-in-providers.spec.ts` stores Apple's and Google's sign-in
-- credentials from `/integrations/sign-in` and switches a provider off again.
-- The providers decide how the tenant's readers can sign in, so no tenant
-- another suite reads can absorb them.
--
-- Applying it is also how the suite puts the tenant back: both providers'
-- settings are deleted, and the tenant keeps the iOS app its app links name.
-- public_id values are hard-coded in e2e/src/scenarios/sign-in-providers.ts.
--   tenant SgnnTNNTAAA1 (sign-in.localhost / admin.sign-in.localhost)
--   admin  SgnnADMNAAA1 (sign-in-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f1040-0001-7000-8000-000000000001'::uuid AS id
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
    'SgnnTNNTAAA1',
    'sign-in.localhost:' || :'tenant_port',
    'admin.sign-in.localhost:' || :'tenant_port',
    'Sign-in Providers Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

\set seed_tenant SgnnTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f1040-0002-7000-8000-000000000001'::uuid AS id
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
    'SgnnADMNAAA1',
    'sign-in-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Sign-in Providers E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'SgnnTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1040-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'SgnnADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM tenant_apple_sign_in_config
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SgnnTNNTAAA1');

DELETE FROM tenant_google_sign_in_config
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'SgnnTNNTAAA1');

-- The iOS app Sign in with Apple accepts, which the settings show read-only.
INSERT INTO tenant_config (tenant_id, ios_team_id, ios_bundle_identifier)
SELECT t.id, 'ABCDE12345', 'com.example.reader'
FROM tenants t
WHERE t.public_id = 'SgnnTNNTAAA1'
ON CONFLICT (tenant_id) DO UPDATE
SET ios_team_id = EXCLUDED.ios_team_id,
    ios_bundle_identifier = EXCLUDED.ios_bundle_identifier;
