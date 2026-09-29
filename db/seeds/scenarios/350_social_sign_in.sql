-- Scenario: tenants that sign readers in with Apple and Google
--
-- `host.social-sign-in.spec.ts` signs readers in through the sign-in-provider
-- stand-in the E2E stack runs, which signs ID tokens for the client IDs below.
-- Which providers a tenant offers changes its sign-in screen, so no tenant
-- another suite reads can offer them.
--
-- The first tenant offers both providers and holds a member with a password,
-- whose address a Google account links to. The second offers Google and names
-- a terms page, so a first sign-in there asks for consent before the account
-- is created. Apple's key is never used: the suite signs in with Google, and
-- an Apple sign-in without an authorization code exchanges nothing.
--
-- Applying it is also how the suite starts over: the tenants are deleted and
-- written again, which takes the accounts and the links the suite created.
-- public_id values and client IDs are hard-coded in
-- e2e/src/scenarios/social-sign-in.ts.
--   tenant SoclTNNTAAA1 (social.localhost / admin.social.localhost)
--   member SoclMMBRAAA1 (social-member@example.com, memberpass)
--   tenant SoclTNNTAAA2 (social-consent.localhost /
--     admin.social-consent.localhost)

DELETE FROM tenants
WHERE public_id IN ('SoclTNNTAAA1', 'SoclTNNTAAA2');

INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale
)
VALUES
    (
        '018f1050-0001-7000-8000-000000000001'::uuid,
        'SoclTNNTAAA1',
        'social.localhost:' || :'tenant_port',
        'admin.social.localhost:' || :'tenant_port',
        'Social Sign-in Tenant',
        'active',
        'en'
    ),
    (
        '018f1050-0001-7000-8000-000000000002'::uuid,
        'SoclTNNTAAA2',
        'social-consent.localhost:' || :'tenant_port',
        'admin.social-consent.localhost:' || :'tenant_port',
        'Social Consent Tenant',
        'active',
        'en'
    );

INSERT INTO tenant_google_sign_in_config (tenant_id, enabled, web_client_id)
SELECT t.id, TRUE, '123456789012-e2esocial.apps.googleusercontent.com'
FROM tenants t
WHERE t.public_id IN ('SoclTNNTAAA1', 'SoclTNNTAAA2');

INSERT INTO tenant_apple_sign_in_config (
    tenant_id,
    enabled,
    services_id,
    team_id,
    key_id,
    private_key_encrypted,
    private_key_hint
)
SELECT
    t.id,
    TRUE,
    'com.example.social.web',
    'ABCDE12345',
    'KEYID12345',
    'enc:unused-in-e2e',
    '••••'
FROM tenants t
WHERE t.public_id = 'SoclTNNTAAA1';

-- Password hash matches the dev seed (`memberpass`).
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
    '018f1050-0002-7000-8000-000000000001'::uuid,
    t.id,
    'SoclMMBRAAA1',
    'social-member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Social Sign-in E2E Member',
    'active',
    NOW()
FROM tenants t
WHERE t.public_id = 'SoclTNNTAAA1';

INSERT INTO pages (id, tenant_id, slug)
SELECT '018f1050-0003-7000-8000-000000000001'::uuid, t.id, '/terms'
FROM tenants t
WHERE t.public_id = 'SoclTNNTAAA2';

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
SELECT
    '018f1050-0004-7000-8000-000000000001'::uuid,
    '018f1050-0003-7000-8000-000000000001'::uuid,
    t.id,
    t.default_locale,
    'Terms of service'
FROM tenants t
WHERE t.public_id = 'SoclTNNTAAA2';

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
    '018f1050-0005-7000-8000-000000000001'::uuid,
    pt.page_id,
    pt.id,
    pt.tenant_id,
    1,
    E'## Terms\n\nThe terms of service.',
    'published',
    NOW()
FROM page_translations pt
WHERE pt.id = '018f1050-0004-7000-8000-000000000001'::uuid;

UPDATE page_translations
SET published_version_id = '018f1050-0005-7000-8000-000000000001'::uuid
WHERE id = '018f1050-0004-7000-8000-000000000001'::uuid;

INSERT INTO tenant_config (tenant_id, terms_page_id)
SELECT t.id, '018f1050-0003-7000-8000-000000000001'::uuid
FROM tenants t
WHERE t.public_id = 'SoclTNNTAAA2';
