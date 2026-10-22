-- Scenario: a tenant whose crawler exclusions the E2E may change
--
-- `admin.crawler-settings.spec.ts` excludes a crawler and a path from
-- `/settings` and reads both back. The setting is one for a whole tenant, and
-- the documentation's screenshots photograph the development seed tenant's
-- card, so a tenant of its own keeps either from seeing the other's saves. An
-- editor of the same tenant sees the setting read-only.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes the setting and the audit entries of the saves
-- with it.
-- Password hashes match the dev seed (`adminpass`).
-- public_id values are hard-coded in e2e/src/scenarios/crawler-settings.ts.
--   tenant CrwlTNNTAAA1 (crawlers.localhost / admin.crawlers.localhost)
--   admin  CrwlADMNAAA1 (crawlers-admin@example.com)
--   editor CrwlEDTRAAA1 (crawlers-editor@example.com)

DELETE FROM tenants
WHERE public_id = 'CrwlTNNTAAA1';

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
VALUES (
    '018f1130-0001-7000-8000-000000000001'::uuid,
    'CrwlTNNTAAA1',
    'crawlers.localhost:' || :'tenant_port',
    'admin.crawlers.localhost:' || :'tenant_port',
    'Crawler Settings Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant CrwlTNNTAAA1
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
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    seed.name,
    'active',
    NOW()
FROM (
    VALUES
        (
            '018f1130-0002-7000-8000-000000000001'::uuid,
            'CrwlADMNAAA1',
            'crawlers-admin@example.com',
            'Crawler Settings E2E Admin'
        ),
        (
            '018f1130-0002-7000-8000-000000000002'::uuid,
            'CrwlEDTRAAA1',
            'crawlers-editor@example.com',
            'Crawler Settings E2E Editor'
        )
) AS seed (id, public_id, email, name)
JOIN tenants t ON t.public_id = 'CrwlTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT seed.id, u.id, seed.role, u.tenant_id
FROM (
    VALUES
        (
            '018f1130-0003-7000-8000-000000000001'::uuid,
            'CrwlADMNAAA1',
            'tenant_admin'
        ),
        (
            '018f1130-0003-7000-8000-000000000002'::uuid,
            'CrwlEDTRAAA1',
            'tenant_editor'
        )
) AS seed (id, public_id, role)
JOIN users u ON u.public_id = seed.public_id;
