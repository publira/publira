-- Scenario: a reader with two-step verification on, for the console's
-- documentation screenshots
--
-- e2e/tests/admin.readers.docs-screenshots.spec.ts opens the confirmation that
-- removes this reader's two-step verification and photographs it without
-- confirming, so the account keeps its authenticator. It is neither the reader
-- of 821_docs_reader_mfa.sql, whom the storefront screenshots enroll and reset
-- once for every locale, nor the one of 210_reader_moderation.sql, whose
-- authenticator the readers E2E removes. The secret is a placeholder: nothing
-- signs in as this reader, so it is never decrypted. The account's dates are
-- fixed, since Readers lists it, and when it signed up, in the documentation's
-- screenshot of the list; it signed up after the newest account of
-- 370_admin_mfa_settings.sql, which keeps it the first row.
-- public_id is hard-coded in e2e/src/scenarios/storefront-reader-mfa.ts.
--   reader MfaRMMBRAAA3
-- The password hash matches the dev seed's `memberpass`.

INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    email_verified_at,
    created_at
)
SELECT
    '018f10f0-0820-7000-8000-000000000003'::uuid,
    t.id,
    'MfaRMMBRAAA3',
    'reader-mfa-console-docs@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Sample Two-step Reader',
    'active',
    TIMESTAMPTZ '2026-01-05 10:45:00+00',
    TIMESTAMPTZ '2026-01-05 10:40:00+00'
FROM tenants t
WHERE t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at,
    created_at = EXCLUDED.created_at;

INSERT INTO user_mfa_totp (user_id, tenant_id, secret_encrypted, enabled_at)
SELECT u.id, u.tenant_id, 'docs-not-a-sealed-secret', TIMESTAMPTZ '2026-01-05 11:00:00+00'
FROM users u
WHERE u.public_id = 'MfaRMMBRAAA3'
ON CONFLICT (user_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    secret_encrypted = EXCLUDED.secret_encrypted,
    enabled_at = EXCLUDED.enabled_at,
    last_verified_step = NULL;
