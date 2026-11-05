-- Scenario: the API keys, webhook endpoints, and deliveries the
-- documentation's screenshots show
--
-- The page under docs/<locale>/4-console/ about API keys and webhooks
-- photographs a tenant's keys, an endpoint, and its deliveries. A key, a
-- secret, and every date the screens print are made by the server at the
-- moment they happen, so the rows are written here as literals instead of
-- created from the forms. A key's hash is of no key at all, and an endpoint's
-- sealed secret is no secret: the screens show only a key's prefix and a
-- secret's hint, and the screenshots never send to or rotate the endpoint.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts. The rows are deleted
-- and written again, so it can be applied any number of times.
-- public_id values are hard-coded in e2e/src/scenarios/docs-webhooks.ts.
--   tenant DwhkTNNTAAA1 (hook-docs.localhost / admin.hook-docs.localhost)
--   admin  DwhkADMNAAA1 (hook-docs-admin@example.com)
--
-- ID band: 018f1ad0-000N-7000-8000-0000000000NN.

WITH tenant_seed AS (
    SELECT '018f1ad0-0001-7000-8000-000000000001'::uuid AS id
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
    'DwhkTNNTAAA1',
    'hook-docs.localhost:' || :'tenant_port',
    'admin.hook-docs.localhost:' || :'tenant_port',
    'Hook Docs Tenant',
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

\set seed_tenant DwhkTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f1ad0-0002-7000-8000-000000000001'::uuid AS id
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
    'DwhkADMNAAA1',
    'hook-docs-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Hook Docs E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'DwhkTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1ad0-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'DwhkADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

-- A delivery goes with its endpoint.
DELETE FROM tenant_webhook_endpoints
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'DwhkTNNTAAA1');

DELETE FROM tenant_api_keys
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'DwhkTNNTAAA1');

-- A key the warehouse reads the catalog and the purchases with, one the CRM
-- reads purchases with, and an older one that was revoked.
INSERT INTO tenant_api_keys (
    id,
    tenant_id,
    name,
    prefix,
    key_hash,
    scopes,
    created_at,
    last_used_at,
    revoked_at
)
SELECT
    seed.id,
    t.id,
    seed.name,
    seed.prefix,
    decode(repeat(seed.hash_byte, 32), 'hex'),
    seed.scopes,
    seed.created_at,
    seed.last_used_at,
    seed.revoked_at
FROM (
    VALUES
        (
            '018f1ad0-0004-7000-8000-000000000001'::uuid,
            'Data warehouse',
            'm4k2q7xw3pzd',
            '01',
            ARRAY['catalog:read', 'purchases:read'],
            '2026-10-01 09:00:00+00'::timestamptz,
            '2026-11-02 06:15:00+00'::timestamptz,
            NULL::timestamptz
        ),
        (
            '018f1ad0-0004-7000-8000-000000000002',
            'CRM',
            'r7t3v5n2bc6h',
            '02',
            ARRAY['purchases:read'],
            '2026-10-15 01:30:00+00',
            NULL,
            NULL
        ),
        (
            '018f1ad0-0004-7000-8000-000000000003',
            'Old sync job',
            'a2c4e6g7j3kq',
            '03',
            ARRAY['catalog:read'],
            '2026-07-01 00:00:00+00',
            '2026-09-30 23:40:00+00',
            '2026-10-01 09:05:00+00'
        )
) AS seed (
    id, name, prefix, hash_byte, scopes, created_at, last_used_at, revoked_at
)
JOIN tenants t ON t.public_id = 'DwhkTNNTAAA1';

INSERT INTO tenant_webhook_endpoints (
    id,
    tenant_id,
    url,
    secret_encrypted,
    secret_hint,
    event_types,
    enabled,
    created_at,
    updated_at
)
SELECT
    '018f1ad0-0005-7000-8000-000000000001'::uuid,
    t.id,
    'https://crm.example.com/hooks/publira',
    'not-a-sealed-secret',
    'whsec_••••••••7f3a',
    ARRAY['purchase.completed', 'purchase.refunded', 'reader.signed_up'],
    TRUE,
    '2026-10-15 01:35:00+00',
    '2026-10-20 04:00:00+00'
FROM tenants t
WHERE t.public_id = 'DwhkTNNTAAA1';

-- One delivered sale, one refund that is being retried, one sign-up given up
-- after its 20 attempts, and the test that was sent when the endpoint was saved.
INSERT INTO webhook_deliveries (
    id,
    tenant_id,
    endpoint_id,
    event_type,
    event_id,
    payload,
    status,
    attempts,
    last_status_code,
    last_error,
    delivered_at,
    created_at,
    updated_at
)
SELECT
    seed.id,
    t.id,
    '018f1ad0-0005-7000-8000-000000000001'::uuid,
    seed.event_type,
    seed.event_id,
    '{}'::jsonb,
    seed.status,
    seed.attempts,
    seed.last_status_code,
    seed.last_error,
    seed.delivered_at,
    seed.created_at,
    seed.updated_at
FROM (
    VALUES
        (
            '018f1ad0-0006-7000-8000-000000000001'::uuid,
            'webhook.test',
            'evt_docs_0001',
            'delivered',
            1,
            204,
            NULL::text,
            '2026-10-20 04:00:02+00'::timestamptz,
            '2026-10-20 04:00:00+00'::timestamptz,
            '2026-10-20 04:00:02+00'::timestamptz
        ),
        (
            '018f1ad0-0006-7000-8000-000000000002',
            'reader.signed_up',
            'evt_docs_0002',
            'dead',
            20,
            NULL,
            'Post "https://crm.example.com/hooks/publira": context deadline exceeded',
            NULL,
            '2026-10-29 10:12:00+00',
            '2026-10-30 08:40:00+00'
        ),
        (
            '018f1ad0-0006-7000-8000-000000000003',
            'purchase.refunded',
            'evt_docs_0003',
            'failed',
            3,
            503,
            'the endpoint answered HTTP 503',
            NULL,
            '2026-11-02 05:58:00+00',
            '2026-11-02 06:05:00+00'
        ),
        (
            '018f1ad0-0006-7000-8000-000000000004',
            'purchase.completed',
            'evt_docs_0004',
            'delivered',
            1,
            200,
            NULL,
            '2026-11-02 06:20:01+00',
            '2026-11-02 06:20:00+00',
            '2026-11-02 06:20:01+00'
        )
) AS seed (
    id,
    event_type,
    event_id,
    status,
    attempts,
    last_status_code,
    last_error,
    delivered_at,
    created_at,
    updated_at
)
JOIN tenants t ON t.public_id = 'DwhkTNNTAAA1';
