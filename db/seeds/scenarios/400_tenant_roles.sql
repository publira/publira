-- Scenario: a tenant editor and a tenant auditor of the development seed tenant
--
-- The console shows each tenant role only the controls it may use, and the
-- suite checking that signs in as one account of each role below tenant_admin.
-- They belong to the development seed tenant because its catalogue, pages,
-- announcements, and comments are what the screens under test list. Neither
-- account is changed by the suite, so re-applying the file only restores them.
-- The password hash matches the dev seed's `adminpass`.
-- public_id values are hard-coded in e2e/src/scenarios/tenant-roles.ts.
--   editor  RoleEDTRAAA1
--   auditor RoleADTRAAA1

WITH editor_user_seed AS (
    SELECT '018f0e8a-4000-7000-8000-000000000001'::uuid AS id
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
    eus.id,
    t.id,
    'RoleEDTRAAA1',
    'roles-editor@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Roles E2E Editor',
    'active',
    NOW()
FROM editor_user_seed eus
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

DELETE FROM tenant_user_roles
WHERE user_id = (SELECT id FROM users WHERE public_id = 'RoleEDTRAAA1')
  AND role <> 'tenant_editor';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0e8b-4000-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_editor',
    u.tenant_id
FROM users u
WHERE u.public_id = 'RoleEDTRAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

WITH auditor_user_seed AS (
    SELECT '018f0e8a-4000-7000-8000-000000000002'::uuid AS id
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
    'RoleADTRAAA1',
    'roles-auditor@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Roles E2E Auditor',
    'active',
    NOW()
FROM auditor_user_seed aus
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

DELETE FROM tenant_user_roles
WHERE user_id = (SELECT id FROM users WHERE public_id = 'RoleADTRAAA1')
  AND role <> 'tenant_auditor';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0e8b-4000-7000-8000-000000000002'::uuid,
    u.id,
    'tenant_auditor',
    u.tenant_id
FROM users u
WHERE u.public_id = 'RoleADTRAAA1'
ON CONFLICT (user_id, role) DO NOTHING;
