-- Scenario: platform operators for the tenant coin allowance E2E
--
-- `platform.security-policy.spec.ts` turns the platform's allowance for
-- tenant-issued coins on and off from the Platform Console's Security page as
-- an Operator, and has an Auditor's save of the same page refused. Both are
-- accounts of their own, so the suite counts the audit entries of the one it
-- saved as without another suite's saves among them.
--
-- Applying the file is also how the suite puts the policy back: it switches
-- the allowance off, the value every other suite expects.
-- Password hash matches the dev seed (`platformpass`).
-- public_id values are hard-coded in e2e/src/scenarios/platform-tenant-coins.ts.
--   platform user TcnsPFUSAAA1 (coins-operator@example.com)
--   platform user TcnsPFUSAAA2 (coins-auditor@example.com)

INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
VALUES
    (
        '018f1650-0001-7000-8000-000000000001'::uuid,
        'TcnsPFUSAAA1',
        'coins-operator@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Coins E2E Operator',
        'active'
    ),
    (
        '018f1650-0001-7000-8000-000000000002'::uuid,
        'TcnsPFUSAAA2',
        'coins-auditor@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Coins E2E Auditor',
        'active'
    )
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    seed.id,
    pu.id,
    seed.role
FROM (
    VALUES
        ('018f1650-0002-7000-8000-000000000001'::uuid, 'TcnsPFUSAAA1', 'platform_operator'),
        ('018f1650-0002-7000-8000-000000000002'::uuid, 'TcnsPFUSAAA2', 'platform_auditor')
) AS seed (id, public_id, role)
JOIN platform_users pu ON pu.public_id = seed.public_id
ON CONFLICT (platform_user_id, role) DO NOTHING;

UPDATE platform_policy_config
SET tenant_coins_allowed = FALSE,
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton
    AND tenant_coins_allowed;
