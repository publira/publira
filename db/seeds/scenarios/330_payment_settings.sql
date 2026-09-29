-- Scenario: a tenant whose payment provider credentials the E2E may store and clear
--
-- `admin.payment-settings.spec.ts` chooses PAY.JP from `/integrations/payment`,
-- stores its credentials, and removes one again. The settings decide whether
-- the tenant's storefront can charge a reader at all, so no tenant another
-- suite reads can absorb them.
--
-- Applying it is also how the suite puts the tenant back: the stored
-- settings are deleted, which leaves the tenant with no provider.
-- public_id values are hard-coded in e2e/src/scenarios/payment-settings.ts.
--   tenant PaymTNNTAAA1 (payment.localhost / admin.payment.localhost)
--   admin  PaymADMNAAA1 (payment-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f1030-0001-7000-8000-000000000001'::uuid AS id
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
    'PaymTNNTAAA1',
    'payment.localhost:' || :'tenant_port',
    'admin.payment.localhost:' || :'tenant_port',
    'Payment Settings Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

\set seed_tenant PaymTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f1030-0002-7000-8000-000000000001'::uuid AS id
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
    'PaymADMNAAA1',
    'payment-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Payment Settings E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'PaymTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1030-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'PaymADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM tenant_payment_config
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'PaymTNNTAAA1');
