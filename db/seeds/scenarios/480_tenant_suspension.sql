-- Scenario: a tenant the E2E suspends and resumes
--
-- `platform.tenant-suspension.spec.ts` suspends this tenant from the Platform
-- Console, opens its site and its console while it is suspended, and resumes
-- it. A suspended tenant refuses every request, so no tenant another suite
-- reads can be the one suspended. The hosts below are placeholders: the web
-- apps keep a host they resolved while its tenant was served for minutes, so
-- the suite moves the tenant to hosts made up for each attempt.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, active, which takes the audit entries the suspension and the
-- resume recorded with it.
-- public_id values are hard-coded in e2e/src/scenarios/tenant-suspension.ts.
--   tenant PausTNNTAAA1 (suspend.localhost / admin.suspend.localhost)
--   admin  PausADMNAAA1 (suspend-admin@example.com)

DELETE FROM tenants
WHERE public_id = 'PausTNNTAAA1';

WITH tenant_seed AS (
    SELECT '018f10a0-0001-7000-8000-000000000001'::uuid AS id
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
    'PausTNNTAAA1',
    'suspend.localhost:' || :'tenant_port',
    'admin.suspend.localhost:' || :'tenant_port',
    'Suspension Tenant',
    'active',
    'en'
FROM tenant_seed ts;

\set seed_tenant PausTNNTAAA1
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
    '018f10a0-0002-7000-8000-000000000001'::uuid,
    t.id,
    'PausADMNAAA1',
    'suspend-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Suspension E2E Admin',
    'active',
    NOW()
FROM tenants t
WHERE t.public_id = 'PausTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f10a0-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'PausADMNAAA1';
