-- Scenario: a reader with a purchase and an access ticket, and one with neither
--
-- `admin.reader-records.spec.ts` opens each reader's page in the console of
-- the development seed tenant: the first lists their purchase and their
-- ticket, revokes the ticket, and issues another, and the second shows both
-- sections empty. The dev seed member cannot absorb that: other suites count
-- its purchases and sign in with the ticket it holds.
--
-- Applying this file is also how the suite starts over, so the readers'
-- purchases and tickets are deleted, the ones the suite issued included, and
-- written again.
-- Password hash matches the dev seed (`memberpass`). public_id values are
-- hard-coded in e2e/src/scenarios/reader-records.ts.
--   reader RrecMMBRAAA1 (reader-records-buyer@example.com)
--   reader RrecMMBRAAA2 (reader-records-empty@example.com)
--   ticket RrecTCKTAAA1, purchase of Seed Episode 001-10 (SeedEPSDAA1A),
--   ticket for Seed Episode 001-02 (SeedEPSDAAA2)

DELETE FROM access_tickets
WHERE user_id IN (
    SELECT id FROM users WHERE public_id IN ('RrecMMBRAAA1', 'RrecMMBRAAA2')
);

DELETE FROM purchases
WHERE user_id IN (
    SELECT id FROM users WHERE public_id IN ('RrecMMBRAAA1', 'RrecMMBRAAA2')
);

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
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    seed.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f1180-0001-7000-8000-000000000001'::uuid,
            'RrecMMBRAAA1',
            'reader-records-buyer@example.com',
            'Reader Records Buyer'
        ),
        (
            '018f1180-0001-7000-8000-000000000002'::uuid,
            'RrecMMBRAAA2',
            'reader-records-empty@example.com',
            'Reader Records Empty'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO purchases (
    id,
    tenant_id,
    user_id,
    episode_id,
    price_at_purchase,
    currency,
    purchased_at
)
SELECT
    '018f1180-0002-7000-8000-000000000001'::uuid,
    u.tenant_id,
    u.id,
    e.id,
    500,
    'JPY',
    '2026-03-01T12:00:00Z'::timestamptz
FROM users u
JOIN episodes e ON e.tenant_id = u.tenant_id AND e.public_id = 'SeedEPSDAA1A'
WHERE u.public_id = 'RrecMMBRAAA1';

INSERT INTO access_tickets (
    id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    note,
    created_by_user_id,
    created_at
)
SELECT
    '018f1180-0003-7000-8000-000000000001'::uuid,
    u.tenant_id,
    'RrecTCKTAAA1',
    e.id,
    u.id,
    'Reader records E2E: support case',
    (
        SELECT admin.id
        FROM users admin
        WHERE admin.tenant_id = u.tenant_id
            AND admin.email = 'admin@example.com'
    ),
    '2026-03-02T12:00:00Z'::timestamptz
FROM users u
JOIN episodes e ON e.tenant_id = u.tenant_id AND e.public_id = 'SeedEPSDAAA2'
WHERE u.public_id = 'RrecMMBRAAA1';
