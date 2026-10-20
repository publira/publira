-- Scenario: a tenant that switches one of its languages off and on again
--
-- `admin.tenant-languages.spec.ts` switches a language off under Settings,
-- checks that the page editor hides the translation written in it, and
-- switches the language back on. It also moves the default language and checks
-- that the series list names the series in the new one. Every page of the
-- tenant follows that setting, so the tenant cannot be one another suite signs
-- in to.
--
-- The tenant offers Japanese and English, English being the default, and has
-- one page and one series, each translated into both.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again with the languages it started with. The catalog restricts the
-- delete that would reach it from the tenant, so it goes first.
-- Password hash matches the dev seed (`adminpass`). public_id values and ids
-- are hard-coded in e2e/src/scenarios/tenant-languages.ts.
--   tenant LngsTNNTAAA1 (langs.localhost / admin.langs.localhost)
--   admin  LangADMNAAA1 (langs-admin@example.com)
--   series LngsSERSAAA1

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'LngsTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'LngsTNNTAAA1';

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
    '018f10c0-0001-7000-8000-000000000001'::uuid,
    'LngsTNNTAAA1',
    'langs.localhost:' || :'tenant_port',
    'admin.langs.localhost:' || :'tenant_port',
    'Languages Tenant',
    'active',
    'en',
    ARRAY['ja', 'en']
);

INSERT INTO pages (id, tenant_id, slug)
VALUES (
    '018f10c0-0002-7000-8000-000000000001'::uuid,
    '018f10c0-0001-7000-8000-000000000001'::uuid,
    '/about'
);

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
VALUES
    (
        '018f10c0-0004-7000-8000-000000000001'::uuid,
        '018f10c0-0002-7000-8000-000000000001'::uuid,
        '018f10c0-0001-7000-8000-000000000001'::uuid,
        'en',
        'About us'
    ),
    (
        '018f10c0-0004-7000-8000-000000000002'::uuid,
        '018f10c0-0002-7000-8000-000000000001'::uuid,
        '018f10c0-0001-7000-8000-000000000001'::uuid,
        'ja',
        'About us, in Japanese'
    );

INSERT INTO series (id, tenant_id, public_id)
VALUES (
    '018f10c0-0007-7000-8000-000000000001'::uuid,
    '018f10c0-0001-7000-8000-000000000001'::uuid,
    'LngsSERSAAA1'
);

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
VALUES
    (
        '018f10c0-0008-7000-8000-000000000001'::uuid,
        '018f10c0-0007-7000-8000-000000000001'::uuid,
        '018f10c0-0001-7000-8000-000000000001'::uuid,
        'en',
        'Harbor Lights',
        ''
    ),
    (
        '018f10c0-0008-7000-8000-000000000002'::uuid,
        '018f10c0-0007-7000-8000-000000000001'::uuid,
        '018f10c0-0001-7000-8000-000000000001'::uuid,
        'ja',
        'Harbor Lights, in Japanese',
        ''
    );

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
VALUES (
    '018f10c0-0005-7000-8000-000000000001'::uuid,
    '018f10c0-0001-7000-8000-000000000001'::uuid,
    'LangADMNAAA1',
    'langs-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Languages E2E Admin',
    'active',
    NOW()
);

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
VALUES (
    '018f10c0-0006-7000-8000-000000000001'::uuid,
    '018f10c0-0005-7000-8000-000000000001'::uuid,
    'tenant_admin',
    '018f10c0-0001-7000-8000-000000000001'::uuid
);
