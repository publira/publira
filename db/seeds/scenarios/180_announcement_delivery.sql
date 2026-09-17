-- Scenario: the tenant announcements are posted into
--
-- Posting an announcement now raises the unread notification count of every
-- reader it addresses, so the tenant a delivery spec posts into cannot be the
-- one whose empty bell `060_notification_inbox.sql` exists to keep empty.
-- This tenant owns that side of the same divide: everything delivered here is
-- delivered on purpose.
--
-- It owns no series, so nothing but an announcement can notify anyone in it.
-- Password hashes match the dev seed (`adminpass` / `memberpass`). public_id
-- values are hard-coded in e2e/src/scenarios/announcement-delivery.ts.
--   tenant AncmTNNTAAA1 (announce.localhost / admin.announce.localhost)
--   admin  AncmADMNAAA1 — posts the announcements
--   admin  AncmTRGTAAA1 — the recipient a targeted announcement names
--   member AncmMMBRAAA1 — a reader, addressed by a broadcast and by nothing else
--
-- The targeted recipient is a second tenant admin rather than a second reader
-- because the console's audience picker offers the tenant's staff: it is fed by
-- ListTenantUsers, which lists the users holding a tenant_user_roles row.
--
-- ID band: 018f0f90-0001-7000-8000-0000000000NN.

WITH tenant_seed AS (
    SELECT '018f0f90-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
SELECT
    ts.id,
    'AncmTNNTAAA1',
    'announce.localhost',
    'admin.announce.localhost',
    'Announce Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

\set seed_tenant AncmTNNTAAA1
\ir ../creator_roles.sql

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
            '018f0f90-0001-7000-8000-000000000011'::uuid,
            'AncmADMNAAA1',
            'announce-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Announce E2E Admin'
        ),
        (
            '018f0f90-0001-7000-8000-000000000012'::uuid,
            'AncmTRGTAAA1',
            'announce-target@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Announce E2E Target'
        ),
        (
            '018f0f90-0001-7000-8000-000000000013'::uuid,
            'AncmMMBRAAA1',
            'announce-member@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Announce E2E Member'
        )
) AS seed (id, public_id, email, password_hash, name)
JOIN tenants t ON t.domain = 'announce.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    seed.id,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM (
    VALUES
        ('018f0f90-0001-7000-8000-000000000021'::uuid, 'AncmADMNAAA1'),
        ('018f0f90-0001-7000-8000-000000000022'::uuid, 'AncmTRGTAAA1')
) AS seed (id, user_public_id)
JOIN users u ON u.public_id = seed.user_public_id
ON CONFLICT (user_id, role) DO NOTHING;

-- Everything this tenant holds was delivered by a previous run of the spec, so
-- a re-run starts from an empty list and an empty bell.
DELETE FROM notifications n
USING tenants t
WHERE n.tenant_id = t.id
    AND t.domain = 'announce.localhost';

DELETE FROM announcements a
USING tenants t
WHERE a.tenant_id = t.id
    AND t.domain = 'announce.localhost';
