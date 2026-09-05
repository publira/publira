-- Scenario: a tenant admin whose own account the operator-settings E2E may rewrite
--
-- `admin.operator-settings.spec.ts` moves this administrator's email address and
-- saves this tenant's SMTP settings. Neither the development seed admin nor the
-- auth-e2e admin can absorb that: other suites sign in as those addresses, and
-- enabling the seed tenant's SMTP override would reroute every other suite's
-- mail. This file owns an account and a tenant nothing else authenticates as or
-- sends mail through.
--
-- Applying it is also how the suite puts the account and the SMTP row back, so
-- every statement below either writes the starting value or deletes the rows
-- the suite creates. Password hash matches the dev seed (`adminpass`).
-- public_id values are hard-coded in e2e/src/scenarios/operator-settings.ts.
--   tenant AsetTNNTAAA1 (aset.localhost / admin.aset.localhost)
--   admin  AsetADMNAAA1 (aset-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f0f50-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale
)
SELECT
    ts.id,
    'AsetTNNTAAA1',
    'aset.localhost',
    'admin.aset.localhost',
    'Operator Settings Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

WITH admin_user_seed AS (
    SELECT '018f0f50-0002-7000-8000-000000000001'::uuid AS id
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
    'AsetADMNAAA1',
    'aset-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Operator Settings E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'AsetTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0f50-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'AsetADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

INSERT INTO tenant_smtp_config (
    tenant_id,
    smtp_override_enabled,
    host,
    port,
    username,
    password_encrypted,
    encryption,
    from_name,
    from_address,
    reply_to
)
SELECT
    t.id,
    FALSE,
    'mailpit',
    1025,
    'mailpit',
    'enc:seed:tenant:dummy-ciphertext-v1',
    'none',
    'Operator Settings Tenant Mail',
    'no-reply@aset.local',
    'help@aset.local'
FROM tenants t
WHERE t.public_id = 'AsetTNNTAAA1'
ON CONFLICT (tenant_id) DO UPDATE
SET smtp_override_enabled = EXCLUDED.smtp_override_enabled,
    host = EXCLUDED.host,
    port = EXCLUDED.port,
    username = EXCLUDED.username,
    password_encrypted = EXCLUDED.password_encrypted,
    encryption = EXCLUDED.encryption,
    from_name = EXCLUDED.from_name,
    from_address = EXCLUDED.from_address,
    reply_to = EXCLUDED.reply_to,
    updated_at = NOW();

-- A request the suite left behind stays confirmable until it expires, so the
-- link from one run could move the address again during the next one.
DELETE FROM user_email_change_tokens
WHERE user_id IN (SELECT id FROM users WHERE public_id = 'AsetADMNAAA1');
