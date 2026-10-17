-- Scenario: a reader for the storefront passkey sign-in E2E
--
-- The suite registers a passkey for this reader from Chromium's virtual
-- authenticator and then signs in to the site with that passkey alone, so it
-- needs a reader no other suite signs in as. Re-applying the file drops the
-- passkeys the suite registered, which puts the account back to signing in
-- with its password alone.
-- The password hash matches the dev seed's `memberpass`.
-- public_id is hard-coded in e2e/src/scenarios/storefront-passkey.ts.
--   reader PskyMMBRAAA1

WITH member_user_seed AS (
    SELECT '018f10e0-0001-7000-8000-000000000001'::uuid AS id
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
    'PskyMMBRAAA1',
    'passkey-reader@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Passkey E2E Reader',
    'active',
    NOW()
FROM member_user_seed mus
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

DELETE FROM user_webauthn_credentials
WHERE user_id IN (
    SELECT id FROM users WHERE public_id = 'PskyMMBRAAA1'
);
