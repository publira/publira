-- Scenario: a tenant whose notification inbox stays empty (#1380)
--
-- The bell's accessible name carries the unread count, and publishing an
-- episode fans a notification out to every member and every admin of that
-- episode's tenant. A spec that asserts the empty bell therefore cannot share
-- a tenant with the publish flow: `admin.publish-flow` publishes into the dev
-- seed tenant while `host.notifications` / `admin.notifications` are reading
-- the same accounts' inboxes.
--
-- This tenant owns no series, so no spec in the suite can deliver a
-- notification into it. Password hashes match the dev seed (`adminpass` /
-- `memberpass`). public_id values are hard-coded in
-- e2e/src/scenarios/notification-inbox.ts.
--   tenant NtfyTNNTAAA1 (notify.localhost / admin.notify.localhost)
--   admin  NtfyADMNAAA1
--   member NtfyMMBRAAA1

WITH tenant_seed AS (
    SELECT '018f0f20-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
SELECT
    ts.id,
    'NtfyTNNTAAA1',
    'notify.localhost',
    'admin.notify.localhost',
    'Notify Tenant',
    'active',
    'ja'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

WITH admin_user_seed AS (
    SELECT '018f0f21-0001-7000-8000-000000000001'::uuid AS id
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
    aus.id,
    t.id,
    'NtfyADMNAAA1',
    'notify-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Notify E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.domain = 'notify.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0f22-0001-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'NtfyADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

WITH member_user_seed AS (
    SELECT '018f0f23-0001-7000-8000-000000000001'::uuid AS id
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
    'NtfyMMBRAAA1',
    'notify-member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Notify E2E Member',
    'active',
    NOW()
FROM member_user_seed mus
JOIN tenants t ON t.domain = 'notify.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;
