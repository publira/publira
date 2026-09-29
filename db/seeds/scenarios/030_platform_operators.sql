-- Scenario: limited platform operators for role-gated E2E
--
-- Adds a platform_operator (not super admin) next to the dev seed super admin.
-- Password hash matches `platformpass` from db/seeds/dev/001_tenant_users.sql.
-- public_id is hard-coded in tests (e2e/src/scenarios/platform-tenants.ts).
--   platform user   ScenPFUSAAA1

WITH platform_user_seed AS (
    SELECT '018f0e7a-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
SELECT
    pus.id,
    'ScenPFUSAAA1',
    'platform-operator@example.com',
    '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
    'Limited Platform Operator',
    'active'
FROM platform_user_seed pus
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    '018f0e7b-1000-7000-8000-000000000001'::uuid,
    pu.id,
    'platform_operator'
FROM platform_users pu
WHERE pu.public_id = 'ScenPFUSAAA1'
ON CONFLICT (platform_user_id, role) DO NOTHING;

-- Two more platform_operator accounts, for the operator-management E2E
-- (`e2e/tests/platform.operator-management.spec.ts`), which rewrites a role and
-- deactivates an account. Neither can be the operator above: that one is signed
-- in as by the role-denial cases, which need it left a plain active operator.
-- Their public_ids are hard-coded in `e2e/src/scenarios/platform-tenants.ts`.
--   platform users  ScenPFUSAAA3, ScenPFUSAAA4
INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
VALUES
    (
        '018f0e7a-1000-7000-8000-000000000002'::uuid,
        'ScenPFUSAAA3',
        'platform-role-change@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Role Change Platform Operator',
        'active'
    ),
    (
        '018f0e7a-1000-7000-8000-000000000003'::uuid,
        'ScenPFUSAAA4',
        'platform-deactivated@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Deactivated Platform Operator',
        'active'
    )
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

-- Their role is rewritten by the spec, and `UpdateOperatorRole` replaces every
-- row rather than editing one, so re-applying this file has to clear what it
-- left behind. Scoped to these two accounts: the operator above keeps the
-- `DO NOTHING` insert, since nothing changes its role.
DELETE FROM platform_user_roles
WHERE platform_user_id IN (
        SELECT pu.id
        FROM platform_users pu
        WHERE pu.public_id IN ('ScenPFUSAAA3', 'ScenPFUSAAA4')
    );

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    role_seed.id,
    pu.id,
    'platform_operator'
FROM (
        VALUES
            ('018f0e7b-1000-7000-8000-000000000002'::uuid, 'ScenPFUSAAA3'),
            ('018f0e7b-1000-7000-8000-000000000003'::uuid, 'ScenPFUSAAA4')
    ) AS role_seed (id, public_id)
    JOIN platform_users pu ON pu.public_id = role_seed.public_id;
