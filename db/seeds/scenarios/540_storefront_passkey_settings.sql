-- Scenario: readers for the storefront passkey settings E2E
--
-- The suite adds and removes passkeys for these readers from Settings ›
-- Security with Chromium's virtual authenticator, signs in with them, and
-- deletes one of the accounts, so it needs readers no other suite signs in as.
-- Re-applying the file drops the passkeys the suite registered and brings back
-- the account it deleted.
-- public_ids are hard-coded in e2e/src/scenarios/storefront-passkey-settings.ts.
--   reader PkstMMBRAAA1 signs in with a password, whose hash matches the dev
--     seed's `memberpass`.
--   reader PkstMMBRAAA2 has neither a password nor a linked provider, so the
--     suite plants its session.

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
    seed.id,
    t.id,
    seed.public_id,
    seed.email,
    seed.password_hash,
    seed.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f10f0-0001-7000-8000-000000000001'::uuid,
            'PkstMMBRAAA1',
            'passkey-settings@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Passkey Settings E2E Reader'
        ),
        (
            '018f10f0-0001-7000-8000-000000000002'::uuid,
            'PkstMMBRAAA2',
            'passkey-passwordless@example.com',
            NULL,
            'Passwordless Passkey E2E Reader'
        )
) AS seed (id, public_id, email, password_hash, name)
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
    SELECT id FROM users WHERE public_id IN ('PkstMMBRAAA1', 'PkstMMBRAAA2')
);
