-- Scenario: the Platform Console's audit log download
--
-- `platform.audit-log-filters.spec.ts` downloads one week of the Platform
-- Console's audit log as an Auditor and compares the file with the list. The
-- week's entries are written by an Operator of their own, on fixed days long
-- past, so the actor and the period isolate them from what every other suite
-- writes; the Auditor is an account of its own as well, so its downloads are
-- the only entries the suite looks for under its name.
--
-- The platform's default time zone is UTC in the development seed, so the
-- week is 2025-03-03T00:00:00Z up to 2025-03-10T00:00:00Z, and one entry
-- falls just outside it at each end.
-- Password hash matches the dev seed (`platformpass`).
-- public_id values are hard-coded in e2e/src/scenarios/platform-audit-log-export.ts.
--   platform user AxptPFUSAAA1 (audit-export-auditor@example.com)
--   platform user AxptPFUSAAA2 (audit-export-operator@example.com)

INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
VALUES
    (
        '018f1730-0001-7000-8000-000000000001'::uuid,
        'AxptPFUSAAA1',
        'audit-export-auditor@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Export E2E Auditor',
        'active'
    ),
    (
        '018f1730-0001-7000-8000-000000000002'::uuid,
        'AxptPFUSAAA2',
        'audit-export-operator@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Export E2E Operator',
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
        ('018f1730-0002-7000-8000-000000000001'::uuid, 'AxptPFUSAAA1', 'platform_auditor'),
        ('018f1730-0002-7000-8000-000000000002'::uuid, 'AxptPFUSAAA2', 'platform_operator')
) AS seed (id, public_id, role)
JOIN platform_users pu ON pu.public_id = seed.public_id
ON CONFLICT (platform_user_id, role) DO NOTHING;

INSERT INTO platform_audit_logs (id, actor_platform_user_id, actor_role, action, target_type, target_id, outcome, created_at)
SELECT
    seed.id,
    '018f1730-0001-7000-8000-000000000002'::uuid,
    'platform_operator',
    seed.action,
    'operator',
    '018f1730-0001-7000-8000-000000000002',
    'success',
    seed.created_at
FROM (
    VALUES
        ('018f1730-0003-7000-8000-000000000001'::uuid, 'operator_mfa_enrolled', '2025-03-02T23:59:59Z'::timestamptz),
        ('018f1730-0003-7000-8000-000000000002'::uuid, 'operator_updated', '2025-03-03T00:00:00Z'::timestamptz),
        ('018f1730-0003-7000-8000-000000000003'::uuid, 'operator_suspended', '2025-03-05T12:00:00Z'::timestamptz),
        ('018f1730-0003-7000-8000-000000000004'::uuid, 'operator_resumed', '2025-03-09T23:59:59Z'::timestamptz),
        ('018f1730-0003-7000-8000-000000000005'::uuid, 'operator_mfa_disabled', '2025-03-10T00:00:00Z'::timestamptz)
) AS seed (id, action, created_at)
ON CONFLICT (id) DO NOTHING;
