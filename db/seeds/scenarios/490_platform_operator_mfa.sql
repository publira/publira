-- Scenario: platform operators for the two-step verification E2E
--
-- `platform.mfa-sign-in.spec.ts` makes the platform require two-step
-- verification of every operator, enrolls one operator at the sign-in step
-- that requirement holds it at, and then signs in with a code and with a
-- recovery code. `platform.mfa-settings.spec.ts` turns the factor on, renews
-- its recovery codes, and turns it off from the account settings of another.
-- Each enrollment holds every later sign-in of its account for a code, so
-- both need operators no other suite signs in as.
--
-- Applying the file is also how the suites put everything back: it drops what
-- they enrolled, so both accounts sign in on a password alone again, and it
-- switches the requirement off, which the sign-in suite cannot do from the
-- console once it holds every operator at enrollment.
-- Password hash matches the dev seed (`platformpass`).
-- public_id values are hard-coded in e2e/src/scenarios/platform-mfa.ts.
--   platform user MfaoPFUSAAA1 (mfa-operator@example.com)
--   platform user MfsoPFUSAAA1 (mfa-settings-operator@example.com)

INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
VALUES
    (
        '018f0f53-0001-7000-8000-000000000001'::uuid,
        'MfaoPFUSAAA1',
        'mfa-operator@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'MFA E2E Operator',
        'active'
    ),
    (
        '018f0f53-0001-7000-8000-000000000002'::uuid,
        'MfsoPFUSAAA1',
        'mfa-settings-operator@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'MFA Settings E2E Operator',
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
    'platform_operator'
FROM (
    VALUES
        ('018f0f53-0002-7000-8000-000000000001'::uuid, 'MfaoPFUSAAA1'),
        ('018f0f53-0002-7000-8000-000000000002'::uuid, 'MfsoPFUSAAA1')
) AS seed (id, public_id)
JOIN platform_users pu ON pu.public_id = seed.public_id
ON CONFLICT (platform_user_id, role) DO NOTHING;

DELETE FROM platform_user_mfa_recovery_codes
WHERE platform_user_id IN (
    SELECT id FROM platform_users WHERE public_id IN ('MfaoPFUSAAA1', 'MfsoPFUSAAA1')
);

DELETE FROM platform_user_mfa_totp
WHERE platform_user_id IN (
    SELECT id FROM platform_users WHERE public_id IN ('MfaoPFUSAAA1', 'MfsoPFUSAAA1')
);

UPDATE platform_policy_config
SET mfa_required_for_platform_operator = FALSE,
    revision = revision + 1,
    updated_at = NOW()
WHERE singleton
    AND mfa_required_for_platform_operator;
