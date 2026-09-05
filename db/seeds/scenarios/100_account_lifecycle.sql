-- Scenario: the accounts the reader account-lifecycle E2E owns
--
-- `host.account-lifecycle.spec.ts` signs readers up from `/signup`, confirms
-- them from the mailed `/verify` link, and resets a registered reader's
-- password. No account another suite signs in with can absorb either half: a
-- sign-up needs an address that is not registered when the run starts, and a
-- reset rewrites the password hash and bumps `credentials_version`.
--
-- Applying it is also how the suite cleans up, so every statement below either
-- writes the starting value or deletes the rows the suite creates. Verification
-- and reset tokens cascade from their user.
-- Password hash matches the dev seed (`memberpass`).
-- public_id values are hard-coded in e2e/src/scenarios/account-lifecycle.ts.
--   member AlifMMBRAAA1 (account-lifecycle-member@example.com)

WITH member_user_seed AS (
    SELECT '018f0f30-0003-7000-8000-000000000001'::uuid AS id
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
    'AlifMMBRAAA1',
    'account-lifecycle-member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Account Lifecycle E2E Member',
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

-- A reset the suite left behind stays confirmable until it expires, so the link
-- from one run could change the password during the next one.
DELETE FROM user_password_reset_tokens
WHERE user_id IN (SELECT id FROM users WHERE public_id = 'AlifMMBRAAA1');

-- The accounts the suite creates through `/signup`. They are created by the
-- flow under test rather than by this file, and that flow creates nothing when
-- the address is already registered, so a run must start with neither present.
DELETE FROM users
WHERE tenant_id = (SELECT id FROM tenants WHERE domain = 'localhost')
  AND email IN (
      'account-lifecycle-new@example.com',
      'account-lifecycle-expired@example.com'
  );
