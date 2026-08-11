-- Scenario: limited platform operators for role-gated E2E (#517)
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
