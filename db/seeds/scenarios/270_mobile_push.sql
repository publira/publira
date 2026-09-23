-- Scenario: a tenant whose Firebase credentials the E2E may add, replace, and remove
--
-- `admin.mobile-push.spec.ts` saves this tenant's FCM service account key from
-- `/integrations/mobile-push` and removes it again. The key decides whether the
-- tenant's mobile app is sent any push at all, so no tenant another suite reads
-- can absorb it.
--
-- Applying it is also how the suite puts the tenant back: the stored
-- credentials are deleted, which turns mobile push off.
-- public_id values are hard-coded in e2e/src/scenarios/mobile-push.ts.
--   tenant MpshTNNTAAA1 (mobile-push.localhost / admin.mobile-push.localhost)
--   admin  MpshADMNAAA1 (mobile-push-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f0fc0-0001-7000-8000-000000000001'::uuid AS id
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
    'MpshTNNTAAA1',
    'mobile-push.localhost',
    'admin.mobile-push.localhost',
    'Mobile Push Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

\set seed_tenant MpshTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f0fc0-0002-7000-8000-000000000001'::uuid AS id
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
    'MpshADMNAAA1',
    'mobile-push-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Mobile Push E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'MpshTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0fc0-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'MpshADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM tenant_fcm_config
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'MpshTNNTAAA1');
