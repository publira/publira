-- Scenario: a tenant whose Google tag the E2E may set in every serving mode
--
-- `admin.google-tag.spec.ts` saves this tenant's Google tag settings from
-- `/integrations/google-tag` in each serving mode and regenerates its gateway
-- path. The settings decide which tag the tenant's site loads and where from,
-- so no tenant another suite reads can absorb them.
--
-- Applying it is also how the suite puts the tenant back: the stored settings
-- are deleted, which leaves the tenant loading no tag.
-- public_id values are hard-coded in e2e/src/scenarios/google-tag.ts.
--   tenant GtagTNNTAAA1 (google-tag.localhost / admin.google-tag.localhost)
--   admin  GtagADMNAAA1 (google-tag-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f1110-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale,
    supported_locales
)
SELECT
    ts.id,
    'GtagTNNTAAA1',
    'google-tag.localhost:' || :'tenant_port',
    'admin.google-tag.localhost:' || :'tenant_port',
    'Google Tag Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale,
    supported_locales = EXCLUDED.supported_locales;

\set seed_tenant GtagTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f1110-0002-7000-8000-000000000001'::uuid AS id
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
    'GtagADMNAAA1',
    'google-tag-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Google Tag E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'GtagTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1110-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'GtagADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM tenant_analytics_settings
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'GtagTNNTAAA1');
