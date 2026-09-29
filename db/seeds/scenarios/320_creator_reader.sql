-- Scenario: a reader account linked to the creator the seed series credits
--
-- `host.creator-own-episode.spec.ts` signs in as the author of `Seed Series
-- 001` and asserts what the storefront shows them on their own episodes: the
-- priced `Seed Episode 001-10` open without a purchase and said to be open to
-- them as its author, and no reaction offered on any of them. The dev seed
-- member cannot be that account, because every other suite reads its episodes
-- as a reader who is not their author.
--
-- The account is linked to `Seed Author 001` alone and holds no purchase or
-- ticket, so the credit is the only thing that can open the priced episode.
-- Password hash matches the dev seed (`memberpass`). public_id values are
-- hard-coded in e2e/src/scenarios/creator-reader.ts.
--   member CrdrMMBRAAA1 (creator-reader@example.com)

WITH member_user_seed AS (
    SELECT '018f1020-0001-7000-8000-000000000001'::uuid AS id
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
    'CrdrMMBRAAA1',
    'creator-reader@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Creator Reader',
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

INSERT INTO creator_accounts (tenant_id, creator_id, user_id)
SELECT c.tenant_id, c.id, u.id
FROM creators c
JOIN users u ON u.tenant_id = c.tenant_id AND u.public_id = 'CrdrMMBRAAA1'
WHERE c.public_id = 'SeedAUTHAAA1'
ON CONFLICT (creator_id, user_id) DO NOTHING;
