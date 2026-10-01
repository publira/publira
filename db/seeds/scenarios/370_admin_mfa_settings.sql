-- Scenario: a tenant administrator for the MFA account settings E2E
--
-- The suite turns two-step verification on from `/settings/account`, which
-- holds every later sign-in of this account for a code, so it needs an admin
-- no other suite signs in as. Re-applying the file drops what the suite
-- enrolled, which puts the account back to signing in on a password alone.
-- The password hash matches the dev seed's `adminpass`.
-- public_id is hard-coded in e2e/src/scenarios/admin-mfa-settings.ts.
--   admin MfasADMNAAA1

WITH admin_user_seed AS (
    SELECT '018f0e8a-3700-7000-8000-000000000001'::uuid AS id
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
    'MfasADMNAAA1',
    'mfa-settings-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'MFA Settings E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0e8b-3700-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'MfasADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM user_mfa_recovery_codes
WHERE user_id = (SELECT id FROM users WHERE public_id = 'MfasADMNAAA1');

DELETE FROM user_mfa_totp
WHERE user_id = (SELECT id FROM users WHERE public_id = 'MfasADMNAAA1');
