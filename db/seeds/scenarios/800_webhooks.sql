-- Scenario: a tenant whose API keys and webhook endpoints the E2E may create,
-- revoke, send to, and delete
--
-- `admin.api-keys-and-webhooks.spec.ts` creates and revokes this tenant's API
-- keys and saves, tests, and deletes its webhook endpoints from
-- `/integrations/api-keys-and-webhooks`. A tenant keeps at most five endpoints,
-- and every sale, refund, sign-up, and subscription of a tenant with one is
-- owed to it, so no tenant another suite reads can absorb them.
--
-- Applying it is also how the suite starts over: the tenant's keys, endpoints,
-- and deliveries are deleted, and so are the audit log entries the suite
-- reads back.
-- public_id values are hard-coded in e2e/src/scenarios/webhooks.ts.
--   tenant WhokTNNTAAA1 (webhooks.localhost / admin.webhooks.localhost)
--   admin  WhokADMNAAA1 (webhooks-admin@example.com)
--   editor WhokEDTRAAA1 (webhooks-editor@example.com)
--
-- ID band: 018f1ac0-000N-7000-8000-0000000000NN.

WITH tenant_seed AS (
    SELECT '018f1ac0-0001-7000-8000-000000000001'::uuid AS id
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
    'WhokTNNTAAA1',
    'webhooks.localhost:' || :'tenant_port',
    'admin.webhooks.localhost:' || :'tenant_port',
    'Webhooks Tenant',
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

\set seed_tenant WhokTNNTAAA1
\ir ../creator_roles.sql

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
    seed.id,
    t.id,
    seed.public_id,
    seed.email,
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    seed.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f1ac0-0002-7000-8000-000000000001'::uuid,
            'WhokADMNAAA1',
            'webhooks-admin@example.com',
            'Webhooks E2E Admin'
        ),
        (
            '018f1ac0-0002-7000-8000-000000000002'::uuid,
            'WhokEDTRAAA1',
            'webhooks-editor@example.com',
            'Webhooks E2E Editor'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'WhokTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT seed.id, u.id, seed.role, u.tenant_id
FROM (
    VALUES
        (
            '018f1ac0-0003-7000-8000-000000000001'::uuid,
            'WhokADMNAAA1',
            'tenant_admin'
        ),
        (
            '018f1ac0-0003-7000-8000-000000000002'::uuid,
            'WhokEDTRAAA1',
            'tenant_editor'
        )
) AS seed (id, public_id, role)
JOIN users u ON u.public_id = seed.public_id
ON CONFLICT (user_id, role) DO NOTHING;

-- A delivery goes with its endpoint.
DELETE FROM tenant_webhook_endpoints
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'WhokTNNTAAA1');

-- An entry a key made holds the key back, so the entries go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'WhokTNNTAAA1');

DELETE FROM tenant_api_keys
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'WhokTNNTAAA1');
