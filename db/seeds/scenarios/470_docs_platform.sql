-- Scenario: the tenants, operators, readers, and records the Platform
-- Console's documentation screenshots show
--
-- The pages under docs/<locale>/3-operations/ explain screens whose rows the
-- development seed either does not hold or dates from the moment it runs: a
-- tenant's staff in every role and its invitations, readers in each
-- status, a suspended tenant, operators in each role and status, the audit log
-- narrowed to one tenant, and a notification that an episode could not be
-- published. Every row here carries its dates as literals, for the reason
-- 160_screenshot_baseline.sql gives.
--
-- They live on two tenants of their own rather than on the seed tenant: the
-- tenant console's screenshots photograph the seed tenant's readers and staff,
-- and a reader added there would appear in those images too. The notification
-- goes to an operator of its own, since the platform's notification suite
-- asserts that the seeded super admin's inbox is empty.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts. Nothing else reads
-- these rows, and the file deletes the ones it cannot upsert before writing
-- them, so it can be applied any number of times. Password hashes match the
-- development seed (`adminpass`, `memberpass`, and `platformpass`).
--   tenant    PdocTNNTAAA1 (platform-docs.localhost), PdocTNNTAAA2 (suspended)
--   staff     PdocADMNAAA1, PdocEDTRAAA1, PdocADTRAAA1
--   readers   PdocMMBRAAA1 (active), PdocMMBRAAA2 (suspended)
--   operators PdocPFUSAAA1 (Operator), PdocPFUSAAA2 (Auditor),
--             PdocPFUSAAA3 (suspended Operator)
--
-- ID band: 018f1090-0007-7000-8000-0000000000NN.

BEGIN;

INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale,
    created_at
)
VALUES
    (
        '018f1090-0007-7000-8000-000000000001'::uuid,
        'PdocTNNTAAA1',
        'platform-docs.localhost:' || :'tenant_port',
        NULL,
        'Platform Docs Tenant',
        'active',
        'en',
        TIMESTAMPTZ '2026-02-02 09:00:00+00'
    ),
    (
        '018f1090-0007-7000-8000-000000000002'::uuid,
        'PdocTNNTAAA2',
        'suspended-docs.localhost:' || :'tenant_port',
        NULL,
        'Suspended Docs Tenant',
        'suspended',
        'en',
        TIMESTAMPTZ '2026-02-03 09:00:00+00'
    )
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale,
    created_at = EXCLUDED.created_at;

-- Three members of staff, one in each role, and two readers.
INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    created_at,
    email_verified_at
)
SELECT
    u.id,
    t.id,
    u.public_id,
    u.email,
    u.password_hash,
    u.name,
    u.status,
    u.created_at,
    u.created_at + INTERVAL '5 minutes'
FROM (
    VALUES
        (
            '018f1090-0007-7000-8000-000000000011'::uuid,
            'PdocADMNAAA1',
            'docs-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Docs Admin',
            'active',
            TIMESTAMPTZ '2026-02-02 09:05:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000012'::uuid,
            'PdocEDTRAAA1',
            'docs-editor@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Docs Editor',
            'active',
            TIMESTAMPTZ '2026-02-06 11:00:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000013'::uuid,
            'PdocADTRAAA1',
            'docs-auditor@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Docs Auditor',
            'active',
            TIMESTAMPTZ '2026-02-07 14:00:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000014'::uuid,
            'PdocMMBRAAA1',
            'docs-reader@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Docs Reader',
            'active',
            TIMESTAMPTZ '2026-02-10 08:00:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000015'::uuid,
            'PdocMMBRAAA2',
            'docs-suspended-reader@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Docs Suspended Reader',
            'suspended',
            TIMESTAMPTZ '2026-02-11 08:00:00+00'
        )
) AS u (id, public_id, email, password_hash, name, status, created_at)
JOIN tenants t ON t.public_id = 'PdocTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    created_at = EXCLUDED.created_at,
    email_verified_at = EXCLUDED.email_verified_at;

-- A role is replaced rather than edited when it changes, so the staff's roles
-- are written again from nothing.
DELETE FROM tenant_user_roles
WHERE user_id IN (
        '018f1090-0007-7000-8000-000000000011'::uuid,
        '018f1090-0007-7000-8000-000000000012'::uuid,
        '018f1090-0007-7000-8000-000000000013'::uuid,
        '018f1090-0007-7000-8000-000000000014'::uuid,
        '018f1090-0007-7000-8000-000000000015'::uuid
    );

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id, created_at)
SELECT r.id, u.id, r.role, u.tenant_id, u.created_at
FROM (
    VALUES
        ('018f1090-0007-7000-8000-000000000021'::uuid, 'PdocADMNAAA1', 'tenant_admin'),
        ('018f1090-0007-7000-8000-000000000022'::uuid, 'PdocEDTRAAA1', 'tenant_editor'),
        ('018f1090-0007-7000-8000-000000000023'::uuid, 'PdocADTRAAA1', 'tenant_auditor')
) AS r (id, public_id, role)
JOIN users u ON u.public_id = r.public_id;

-- Two Tenant admin invitations, one that expired unanswered and one an
-- operator canceled, and an Editor's that expired, as the tenant console sends
-- them. A pending one is left out: whether an invitation is still pending is
-- decided against the current time.
DELETE FROM platform_audit_logs
WHERE id IN (
        '018f1090-0007-7000-8000-000000000051'::uuid,
        '018f1090-0007-7000-8000-000000000052'::uuid,
        '018f1090-0007-7000-8000-000000000053'::uuid,
        '018f1090-0007-7000-8000-000000000054'::uuid,
        '018f1090-0007-7000-8000-000000000055'::uuid,
        '018f1090-0007-7000-8000-000000000056'::uuid
    );

DELETE FROM tenant_admin_invitations
WHERE id IN (
        '018f1090-0007-7000-8000-000000000031'::uuid,
        '018f1090-0007-7000-8000-000000000032'::uuid,
        '018f1090-0007-7000-8000-000000000033'::uuid
    );

INSERT INTO tenant_admin_invitations (
    id,
    tenant_id,
    email,
    token_hash,
    role,
    expires_at,
    canceled_at,
    created_at,
    updated_at
)
SELECT
    i.id,
    t.id,
    i.email,
    i.token_hash,
    i.role,
    i.created_at + INTERVAL '24 hours',
    i.canceled_at,
    i.created_at,
    COALESCE(i.canceled_at, i.created_at)
FROM (
    VALUES
        (
            '018f1090-0007-7000-8000-000000000031'::uuid,
            'docs-new-admin@example.com',
            'docs-screenshots-platform-invitation-1',
            'tenant_admin',
            TIMESTAMPTZ '2026-02-04 10:00:00+00',
            NULL::timestamptz
        ),
        (
            '018f1090-0007-7000-8000-000000000032'::uuid,
            'docs-former-admin@example.com',
            'docs-screenshots-platform-invitation-2',
            'tenant_admin',
            TIMESTAMPTZ '2026-02-05 10:00:00+00',
            TIMESTAMPTZ '2026-02-05 15:30:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000033'::uuid,
            'docs-new-editor@example.com',
            'docs-screenshots-platform-invitation-3',
            'tenant_editor',
            TIMESTAMPTZ '2026-02-06 10:00:00+00',
            NULL::timestamptz
        )
) AS i (id, email, token_hash, role, created_at, canceled_at)
JOIN tenants t ON t.public_id = 'PdocTNNTAAA1';

-- Operators in the two roles the seeded super admin does not hold, and one
-- who is suspended.
INSERT INTO platform_users (id, public_id, email, password_hash, name, status, created_at)
VALUES
    (
        '018f1090-0007-7000-8000-000000000041'::uuid,
        'PdocPFUSAAA1',
        'docs-operator@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Docs Operator',
        'active',
        TIMESTAMPTZ '2026-02-01 09:00:00+00'
    ),
    (
        '018f1090-0007-7000-8000-000000000042'::uuid,
        'PdocPFUSAAA2',
        'docs-platform-auditor@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Docs Platform Auditor',
        'active',
        TIMESTAMPTZ '2026-02-01 09:30:00+00'
    ),
    (
        '018f1090-0007-7000-8000-000000000043'::uuid,
        'PdocPFUSAAA3',
        'docs-suspended-operator@example.com',
        '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
        'Docs Suspended Operator',
        'suspended',
        TIMESTAMPTZ '2026-02-01 10:00:00+00'
    )
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    created_at = EXCLUDED.created_at;

DELETE FROM platform_user_roles
WHERE platform_user_id IN (
        '018f1090-0007-7000-8000-000000000041'::uuid,
        '018f1090-0007-7000-8000-000000000042'::uuid,
        '018f1090-0007-7000-8000-000000000043'::uuid
    );

INSERT INTO platform_user_roles (id, platform_user_id, role, created_at)
SELECT r.id, pu.id, r.role, pu.created_at
FROM (
    VALUES
        ('018f1090-0007-7000-8000-000000000044'::uuid, 'PdocPFUSAAA1', 'platform_operator'),
        ('018f1090-0007-7000-8000-000000000045'::uuid, 'PdocPFUSAAA2', 'platform_auditor'),
        ('018f1090-0007-7000-8000-000000000046'::uuid, 'PdocPFUSAAA3', 'platform_operator')
) AS r (id, public_id, role)
JOIN platform_users pu ON pu.public_id = r.public_id;

-- The tenant's history in the platform's audit log: created and given an
-- administrator from the command line, then worked on by two operators. Each
-- entry's tenant is filled in from its target by the table's trigger.
INSERT INTO platform_audit_logs (
    id,
    actor_platform_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    outcome,
    created_at
)
SELECT
    a.id,
    pu.id,
    a.actor_role,
    a.action,
    a.target_type,
    a.target_id,
    'success',
    a.created_at
FROM (
    VALUES
        (
            '018f1090-0007-7000-8000-000000000051'::uuid,
            NULL,
            'system',
            'tenant_created',
            'tenant',
            '018f1090-0007-7000-8000-000000000001',
            TIMESTAMPTZ '2026-02-02 09:00:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000052'::uuid,
            NULL,
            'system',
            'tenant_member_created',
            'user',
            '018f1090-0007-7000-8000-000000000011',
            TIMESTAMPTZ '2026-02-02 09:05:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000053'::uuid,
            'SeedPFUSAAA1',
            'platform_super_admin',
            'tenant_admin_invited',
            'tenant_admin_invitation',
            '018f1090-0007-7000-8000-000000000031',
            TIMESTAMPTZ '2026-02-04 10:00:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000054'::uuid,
            'PdocPFUSAAA1',
            'platform_operator',
            'tenant_admin_invite_canceled',
            'tenant_admin_invitation',
            '018f1090-0007-7000-8000-000000000032',
            TIMESTAMPTZ '2026-02-05 15:30:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000055'::uuid,
            'PdocPFUSAAA1',
            'platform_operator',
            'tenant_member_added',
            'user',
            '018f1090-0007-7000-8000-000000000012',
            TIMESTAMPTZ '2026-02-06 11:00:00+00'
        ),
        (
            '018f1090-0007-7000-8000-000000000056'::uuid,
            'PdocPFUSAAA1',
            'platform_operator',
            'user_suspended',
            'user',
            '018f1090-0007-7000-8000-000000000015',
            TIMESTAMPTZ '2026-02-11 12:00:00+00'
        )
) AS a (id, actor_public_id, actor_role, action, target_type, target_id, created_at)
LEFT JOIN platform_users pu ON pu.public_id = a.actor_public_id;

-- What the worker writes for every operator when a scheduled episode could not
-- be published, addressed here to the docs operator alone.
DELETE FROM platform_notifications
WHERE id = '018f1090-0007-7000-8000-000000000061'::uuid;

INSERT INTO platform_notifications (
    id,
    platform_user_id,
    notification_type,
    subject_key,
    payload,
    created_at
)
SELECT
    '018f1090-0007-7000-8000-000000000061'::uuid,
    pu.id,
    'episode_publish_failed',
    'episode:SeedEPSDAAA3',
    jsonb_build_object(
        'episode_id', 'SeedEPSDAAA3',
        'episode_title', 'Seed Episode 001-03',
        'series_id', 'SeedSERSAAA1',
        'series_title', 'Seed Series 001',
        'tenant_id', 'SeedTNNTAAA1',
        'tenant_name', 'Seed Tenant'
    ),
    TIMESTAMPTZ '2026-02-12 03:00:00+00'
FROM platform_users pu
WHERE pu.public_id = 'PdocPFUSAAA1';

COMMIT;
