WITH tenant_seed AS (
    SELECT '018f0e6a-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status)
SELECT
    ts.id,
    UPPER(SUBSTRING(REPLACE(ts.id::text, '-', '') FROM 1 FOR 12)),
    'localhost',
    'admin.localhost',
    'Seed Tenant',
    'active'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_config (
    tenant_id,
    copyright_text,
    site_description,
    site_tagline
)
SELECT
    t.id,
    '© Publira Seed Tenant',
    'Seed Tenant の公開向け説明テキストです。',
    '読むたび、世界がひらく。'
FROM tenants t
WHERE t.domain = 'localhost'
ON CONFLICT (tenant_id) DO UPDATE
SET copyright_text = EXCLUDED.copyright_text,
    site_description = EXCLUDED.site_description,
    site_tagline = EXCLUDED.site_tagline,
    updated_at = NOW();

WITH platform_user_seed AS (
    SELECT '018f0e6b-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
SELECT
    pus.id,
    UPPER(SUBSTRING(REPLACE(pus.id::text, '-', '') FROM 1 FOR 12)),
    'platform@example.com',
    '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
    'Platform Operator',
    'active'
FROM platform_user_seed pus
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    '018f0e6c-1000-7000-8000-000000000001'::uuid,
    pu.id,
    'platform_super_admin'
FROM platform_users pu
WHERE pu.email = 'platform@example.com'
ON CONFLICT (platform_user_id, role) DO NOTHING;

WITH admin_user_seed AS (
    SELECT '018f0e6d-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO users (id, tenant_id, public_id, email, password_hash, name, status)
SELECT
    aus.id,
    t.id,
    UPPER(SUBSTRING(REPLACE(aus.id::text, '-', '') FROM 1 FOR 12)),
    'admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Tenant Admin',
    'active'
FROM admin_user_seed aus
JOIN tenants t ON t.domain = 'localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0e6e-1000-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.email = 'admin@example.com'
ON CONFLICT (user_id, role) DO NOTHING;

WITH member_user_seed AS (
    SELECT '018f0e6f-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO users (id, tenant_id, public_id, email, password_hash, name, status)
SELECT
    mus.id,
    t.id,
    UPPER(SUBSTRING(REPLACE(mus.id::text, '-', '') FROM 1 FOR 12)),
    'member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Sample Member',
    'active'
FROM member_user_seed mus
JOIN tenants t ON t.domain = 'localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;
