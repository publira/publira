-- Scenario: readers the admin console's moderation E2E may suspend and delete
--
-- `admin.readers.spec.ts` suspends one reader, lifts the suspension, and
-- deletes another from the reader detail page. The dev seed member cannot
-- absorb either: other suites sign in with its address, and a deleted account
-- is gone for every suite that runs after.
--
-- Applying this file is also how the suite puts both readers back, so each
-- statement writes the starting value, including re-creating the deleted
-- account. Password hash matches the dev seed (`memberpass`).
-- public_id values are hard-coded in e2e/src/scenarios/reader-moderation.ts.
--   member RmodMMBRAAA1 (reader-moderation-suspend@example.com)
--   member RmodMMBRAAA2 (reader-moderation-delete@example.com)

WITH member_user_seed (id, public_id, email, name) AS (
    VALUES
        (
            '018f0f30-0004-7000-8000-000000000001'::uuid,
            'RmodMMBRAAA1',
            'reader-moderation-suspend@example.com',
            'Reader Moderation E2E Suspend'
        ),
        (
            '018f0f30-0004-7000-8000-000000000002'::uuid,
            'RmodMMBRAAA2',
            'reader-moderation-delete@example.com',
            'Reader Moderation E2E Delete'
        )
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
    mus.public_id,
    mus.email,
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    mus.name,
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
