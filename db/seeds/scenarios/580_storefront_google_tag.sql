-- Scenario: a tenant whose site the E2E loads a Google tag on
--
-- `storefront.google-tag.spec.ts` stores this tenant's Google tag settings
-- straight into `tenant_analytics_settings`, one serving mode at a time, and
-- opens the tenant's site to see which tag it loads and from where. The
-- settings decide what every page of the site loads, so no tenant another
-- suite reads can absorb them; `570_google_tag.sql` is the console suite's,
-- which saves its own tenant's settings while this one runs.
--
-- The reader signs in to open the account settings, which load no tag.
-- Applying the file deletes the stored settings, which leaves the tenant
-- loading no tag. The password hash matches the dev seed's `memberpass`.
-- public_id values are hard-coded in e2e/src/scenarios/storefront-google-tag.ts.
--   tenant MsrdTNNTAAA1 (measure.localhost / admin.measure.localhost)
--   reader MsrdMMBRAAA1 (measure-reader@example.com)

WITH tenant_seed AS (
    SELECT '018f1120-0001-7000-8000-000000000001'::uuid AS id
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
    'MsrdTNNTAAA1',
    'measure.localhost:' || :'tenant_port',
    'admin.measure.localhost:' || :'tenant_port',
    'Measured Tenant',
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

\set seed_tenant MsrdTNNTAAA1
\ir ../creator_roles.sql

WITH reader_seed AS (
    SELECT '018f1120-0002-7000-8000-000000000001'::uuid AS id
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
    rs.id,
    t.id,
    'MsrdMMBRAAA1',
    'measure-reader@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Measured E2E Reader',
    'active',
    NOW()
FROM reader_seed rs
JOIN tenants t ON t.public_id = 'MsrdTNNTAAA1'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

DELETE FROM tenant_analytics_settings
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'MsrdTNNTAAA1');
