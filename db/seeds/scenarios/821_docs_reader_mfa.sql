-- Scenario: a reader for the storefront two-step verification screenshots
--
-- e2e/tests/storefront.reader-mfa.docs-screenshots.spec.ts turns two-step
-- verification on for this reader once for every locale, applying the file
-- before each to put the account back to signing in on a password alone. It
-- is not the reader of 820_storefront_reader_mfa.sql, whose suite may be part
-- way through its own enrollment meanwhile.
-- public_id is hard-coded in e2e/src/scenarios/storefront-reader-mfa.ts.
--   reader MfaRMMBRAAA2
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
    '018f10f0-0820-7000-8000-000000000002'::uuid,
    t.id,
    'MfaRMMBRAAA2',
    'reader-mfa-docs@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Two-step Docs Reader',
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
WHERE user_id = (SELECT id FROM users WHERE public_id = 'MfaRMMBRAAA2');

DELETE FROM user_mfa_totp
WHERE user_id = (SELECT id FROM users WHERE public_id = 'MfaRMMBRAAA2');

DELETE FROM user_mfa_lockouts
WHERE user_id = (SELECT id FROM users WHERE public_id = 'MfaRMMBRAAA2');
