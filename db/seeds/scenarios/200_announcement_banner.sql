-- Scenario: the tenant a pinned announcement is shown as a banner in
--
-- A pinned announcement is drawn above every page of its tenant's site, so it
-- is visible to every other spec that browses the same tenant. This tenant owns
-- that side on its own: the banner spec pins and unpins here and nowhere else.
--
-- It owns no series, so the storefront under the band is the same on every run.
-- Password hashes match the dev seed (`adminpass` / `memberpass`). public_id
-- values are hard-coded in e2e/src/scenarios/announcement-banner.ts.
--   tenant BnnrTNNTAAA1 (banner.localhost / admin.banner.localhost)
--   admin  BnnrADMNAAA1 — pins and unpins the announcements
--   member BnnrMMBRAAA1 — a reader, who also reads the site signed out
--
-- ID band: 018f0fb0-0001-7000-8000-0000000000NN.

WITH tenant_seed AS (
    SELECT '018f0fb0-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
SELECT
    ts.id,
    'BnnrTNNTAAA1',
    'banner.localhost',
    'admin.banner.localhost',
    'Banner Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;

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
            '018f0fb0-0001-7000-8000-000000000011'::uuid,
            'BnnrADMNAAA1',
            'banner-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Banner E2E Admin'
        ),
        (
            '018f0fb0-0001-7000-8000-000000000012'::uuid,
            'BnnrMMBRAAA1',
            'banner-member@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Banner E2E Member'
        )
) AS seed (id, public_id, email, password_hash, name)
JOIN tenants t ON t.domain = 'banner.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0fb0-0001-7000-8000-000000000021'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'BnnrADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

-- Everything this tenant holds was posted by a previous run of the spec, so a
-- re-run starts with no banner above the site and an empty list under it.
DELETE FROM notifications n
USING tenants t
WHERE n.tenant_id = t.id
    AND t.domain = 'banner.localhost';

DELETE FROM announcements a
USING tenants t
WHERE a.tenant_id = t.id
    AND t.domain = 'banner.localhost';
