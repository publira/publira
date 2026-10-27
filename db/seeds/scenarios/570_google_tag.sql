-- Scenario: a tenant whose Google tag the E2E may set in every serving mode
--
-- `admin.google-tag.spec.ts` saves this tenant's Google tag settings from
-- `/integrations/google-tag` in each serving mode and each reader consent
-- mode, and regenerates its gateway path. The settings decide which tag the
-- tenant's site loads and where from, so no tenant another suite reads can
-- absorb them.
--
-- Applying it is also how the suite puts the tenant back: the stored settings
-- are deleted, which leaves the tenant loading no tag, and the privacy policy
-- page is left unnamed.
-- public_id values are hard-coded in e2e/src/scenarios/google-tag.ts.
--   tenant GtagTNNTAAA1 (google-tag.localhost / admin.google-tag.localhost)
--   admin  GtagADMNAAA1 (google-tag-admin@example.com)

WITH tenant_seed AS (
    SELECT '018f1110-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale,
    supported_locales
)
SELECT
    ts.id,
    'GtagTNNTAAA1',
    'google-tag.localhost:' || :'tenant_port',
    'admin.google-tag.localhost:' || :'tenant_port',
    'Google Tag Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale,
    supported_locales = EXCLUDED.supported_locales;

\set seed_tenant GtagTNNTAAA1
\ir ../creator_roles.sql

WITH admin_user_seed AS (
    SELECT '018f1110-0002-7000-8000-000000000001'::uuid AS id
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
    'GtagADMNAAA1',
    'google-tag-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Google Tag E2E Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.public_id = 'GtagTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f1110-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'GtagADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

DELETE FROM tenant_analytics_settings
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'GtagTNNTAAA1');

-- A published privacy policy page the suite names as the tenant's, to see the
-- console's warning that the consent banner has none to link to go away.
-- Applying the file leaves it unnamed.
INSERT INTO pages (id, tenant_id, slug)
SELECT '018f1110-0004-7000-8000-000000000001'::uuid, t.id, '/privacy'
FROM tenants t
WHERE t.public_id = 'GtagTNNTAAA1'
ON CONFLICT (id) DO NOTHING;

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
SELECT
    '018f1110-0005-7000-8000-000000000001'::uuid,
    '018f1110-0004-7000-8000-000000000001'::uuid,
    t.id,
    t.default_locale,
    'Privacy policy'
FROM tenants t
WHERE t.public_id = 'GtagTNNTAAA1'
ON CONFLICT (id) DO NOTHING;

INSERT INTO page_versions (
    id,
    page_id,
    translation_id,
    tenant_id,
    version_number,
    content_markdown,
    status,
    published_at
)
SELECT
    '018f1110-0006-7000-8000-000000000001'::uuid,
    pt.page_id,
    pt.id,
    pt.tenant_id,
    1,
    E'## Privacy\n\nThe privacy policy.',
    'published',
    NOW()
FROM page_translations pt
WHERE pt.id = '018f1110-0005-7000-8000-000000000001'::uuid
ON CONFLICT (id) DO NOTHING;

UPDATE page_translations
SET published_version_id = '018f1110-0006-7000-8000-000000000001'::uuid
WHERE id = '018f1110-0005-7000-8000-000000000001'::uuid;

INSERT INTO tenant_config (tenant_id, privacy_page_id)
SELECT t.id, NULL
FROM tenants t
WHERE t.public_id = 'GtagTNNTAAA1'
ON CONFLICT (tenant_id) DO UPDATE
SET privacy_page_id = NULL;
