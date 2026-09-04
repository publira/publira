-- Scenario: a member whose email address the email-change E2E may rewrite
--
-- `host.email-change.spec.ts` runs the address change to its end: it requests
-- one, opens the confirmation link mailed to each side, and then signs in with
-- the address the account has moved to. Neither the dev seed member nor the
-- settings member can absorb that — both are the address another suite signs in
-- with — so this file owns an account whose email nothing else depends on.
--
-- Applying it is also how the suite puts the account back, so every statement
-- below either writes the starting value or deletes the rows the suite creates.
-- Password hash matches the dev seed (`memberpass`).
-- public_id values are hard-coded in e2e/src/scenarios/email-change.ts.
--   member EchgMMBRAAA1 (email-change-member@example.com)

WITH member_user_seed AS (
    SELECT '018f0f30-0002-7000-8000-000000000001'::uuid AS id
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
    'EchgMMBRAAA1',
    'email-change-member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Email Change E2E Member',
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

-- A request the suite left behind stays confirmable until it expires, so the
-- link from one run could move the address again during the next one.
DELETE FROM user_email_change_tokens
WHERE user_id IN (SELECT id FROM users WHERE public_id = 'EchgMMBRAAA1');
