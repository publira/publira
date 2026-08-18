-- Scenario: dedicated accounts for auth/session-expiry E2E (#67)
--
-- Login / logout / missing-cookie cases use the shared dev seed accounts.
-- credentials_version bumps must not race those accounts while other specs
-- hold a live session, so this file adds three isolated users. Password hashes
-- match the dev seed (`adminpass` / `memberpass` / `platformpass`).
-- public_id values are hard-coded in e2e/src/scenarios/auth.ts.
--   admin    ScenADMNAAA1
--   member   ScenMMBRAAA1
--   platform ScenPFUSAAA2

WITH admin_user_seed AS (
    SELECT '018f0e8a-1000-7000-8000-000000000001'::uuid AS id
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
    'ScenADMNAAA1',
    'auth-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Auth E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.domain = 'localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0e8b-1000-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'ScenADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

WITH member_user_seed AS (
    SELECT '018f0e8c-1000-7000-8000-000000000001'::uuid AS id
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
    mus.id,
    t.id,
    'ScenMMBRAAA1',
    'auth-member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Auth E2E Member',
    'active',
    NOW()
FROM member_user_seed mus
JOIN tenants t ON t.domain = 'localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

WITH platform_user_seed AS (
    SELECT '018f0e8d-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
SELECT
    pus.id,
    'ScenPFUSAAA2',
    'auth-platform@example.com',
    '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
    'Auth E2E Platform Admin',
    'active'
FROM platform_user_seed pus
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    '018f0e8e-1000-7000-8000-000000000001'::uuid,
    pu.id,
    'platform_super_admin'
FROM platform_users pu
WHERE pu.public_id = 'ScenPFUSAAA2'
ON CONFLICT (platform_user_id, role) DO NOTHING;
