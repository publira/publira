-- Scenario: a reader for the storefront two-step verification E2E
--
-- e2e/tests/storefront.reader-mfa.spec.ts turns two-step verification on from
-- Settings › Security, which holds every later sign-in of this account for a
-- code, so it needs a reader no other suite signs in as. Re-applying the file
-- drops what the suite enrolled, which puts the account back to signing in on
-- a password alone. The documentation screenshots enroll a reader of their
-- own, in 821_docs_reader_mfa.sql, since they reset theirs while this suite
-- runs.
-- public_id is hard-coded in e2e/src/scenarios/storefront-reader-mfa.ts.
--   reader MfaRMMBRAAA1
-- The password hash matches the dev seed's `memberpass`.

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
    '018f10f0-0820-7000-8000-000000000001'::uuid,
    t.id,
    'MfaRMMBRAAA1',
    'reader-mfa@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Two-step E2E Reader',
    'active',
    NOW()
FROM tenants t
WHERE t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

DELETE FROM user_mfa_recovery_codes
WHERE user_id = (SELECT id FROM users WHERE public_id = 'MfaRMMBRAAA1');

DELETE FROM user_mfa_totp
WHERE user_id = (SELECT id FROM users WHERE public_id = 'MfaRMMBRAAA1');

DELETE FROM user_mfa_lockouts
WHERE user_id = (SELECT id FROM users WHERE public_id = 'MfaRMMBRAAA1');
