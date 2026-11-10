-- Scenario: two readers for the mobile app's two-step verification tests
--
-- mobile/integration_test/catalog_test.dart turns two-step verification on
-- for the first from the app's account screen, and for the second through the
-- public API the way the site's settings do, before signing each in through
-- the app. Either holds every later sign-in of its account for a code, so
-- neither can be an account another test signs in as. Applied by
-- mobile/scripts/e2e-db-setup.sh for the mobile E2E stack only; re-applying
-- the file drops what a run enrolled, which puts both accounts back to
-- signing in on a password alone.
-- The addresses are constants in mobile/test/support/connect_fixture_server.dart.
--   reader enrolled in the app   MfaMMMBRAAA1
--   reader enrolled on the site  MfaMMMBRAAA2
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
    v.id,
    t.id,
    v.public_id,
    v.email,
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    v.name,
    'active',
    NOW()
FROM tenants t
CROSS JOIN (
    VALUES
        (
            '018f10f0-0830-7000-8000-000000000001'::uuid,
            'MfaMMMBRAAA1',
            'reader-mfa-app@example.com',
            'Two-step App Reader'
        ),
        (
            '018f10f0-0830-7000-8000-000000000002'::uuid,
            'MfaMMMBRAAA2',
            'reader-mfa-site@example.com',
            'Two-step Site Reader'
        )
) AS v (id, public_id, email, name)
WHERE t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

DELETE FROM user_mfa_recovery_codes
WHERE user_id IN (
    SELECT id FROM users WHERE public_id IN ('MfaMMMBRAAA1', 'MfaMMMBRAAA2')
);

DELETE FROM user_mfa_totp
WHERE user_id IN (
    SELECT id FROM users WHERE public_id IN ('MfaMMMBRAAA1', 'MfaMMMBRAAA2')
);

DELETE FROM user_mfa_lockouts
WHERE user_id IN (
    SELECT id FROM users WHERE public_id IN ('MfaMMMBRAAA1', 'MfaMMMBRAAA2')
);
