-- Scenario: a suspended tenant the E2E deletes, and the operators who may not
--
-- `platform.tenant-deletion.spec.ts` deletes this tenant from the Platform
-- Console as the seeded Super admin and waits for the worker to erase it, so
-- no tenant another suite reads can be the one deleted. It starts suspended,
-- the only state a tenant can be deleted from. The Operator and the Auditor
-- below open its page first and are not offered the deletion; they are
-- accounts of their own so that no other suite's sign-ins share them.
--
-- Applying it is also how the suite starts over: the tenant, if a failed run
-- left it, is deleted and written again, suspended and not marked for
-- deletion, which takes its audit entries with it.
-- Password hashes match the dev seed (`platformpass`, `adminpass`).
-- public_id values are hard-coded in e2e/src/scenarios/tenant-deletion.ts.
--   tenant        DeltTNNTAAA1 (delete.localhost / admin.delete.localhost)
--   tenant admin  DeltADMNAAA1 (delete-admin@example.com)
--   platform user DeltPFUSAAA1 (deletion-operator@example.com)
--   platform user DeltPFUSAAA2 (deletion-auditor@example.com)

-- The worker files one notification per operator for each tenant it erases,
-- and never a second, so a run's notifications go too: the next run's erasure
-- files its own, and the seeded Super admin's inbox, which another suite
-- expects to be empty, is left as it was.
DELETE FROM platform_notifications
WHERE subject_key = 'tenant:DeltTNNTAAA1';

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'DeltTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'DeltTNNTAAA1';

WITH tenant_seed AS (
    SELECT '018f1840-0001-7000-8000-000000000001'::uuid AS id
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
    'DeltTNNTAAA1',
    'delete.localhost:' || :'tenant_port',
    'admin.delete.localhost:' || :'tenant_port',
    'Deletion Tenant',
    'suspended',
    'en',
    ARRAY['en']
FROM tenant_seed ts;

\set seed_tenant DeltTNNTAAA1
\ir ../creator_roles.sql

-- A row of its own in a table the worker erases, so the suite can tell the
-- tenant was erased rather than only hidden.
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
    '018f1840-0002-7000-8000-000000000001'::uuid,
    t.id,
    'DeltADMNAAA1',
    'delete-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Deletion E2E Admin',
    'active',
    NOW()
FROM tenants t
WHERE t.public_id = 'DeltTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1840-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'DeltADMNAAA1';

INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
VALUES
    (
        '018f1840-0004-7000-8000-000000000001'::uuid,
        'DeltPFUSAAA1',
        'deletion-operator@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Deletion E2E Operator',
        'active'
    ),
    (
        '018f1840-0004-7000-8000-000000000002'::uuid,
        'DeltPFUSAAA2',
        'deletion-auditor@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Deletion E2E Auditor',
        'active'
    )
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    seed.id,
    pu.id,
    seed.role
FROM (
    VALUES
        ('018f1840-0005-7000-8000-000000000001'::uuid, 'DeltPFUSAAA1', 'platform_operator'),
        ('018f1840-0005-7000-8000-000000000002'::uuid, 'DeltPFUSAAA2', 'platform_auditor')
) AS seed (id, public_id, role)
JOIN platform_users pu ON pu.public_id = seed.public_id
ON CONFLICT (platform_user_id, role) DO NOTHING;
