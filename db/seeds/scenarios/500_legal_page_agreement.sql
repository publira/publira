-- Scenario: a tenant that revises the terms its readers agreed to
--
-- `storefront.legal-page-agreement.spec.ts` publishes the terms of service's
-- draft from the console, asking every reader to agree to it, and has the
-- tenant's reader agree on the site. Asking is a request every reader of the
-- tenant answers, so the tenant cannot be one another suite signs in to.
--
-- The reader agreed to the published version of both pages when the account
-- was opened. The terms page has a second version, a draft, which is the one
-- the suite publishes; the privacy policy has one.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, which takes the request, the reader's agreement to it, and
-- the audit entry with it.
-- Password hashes match the dev seed (`adminpass` / `memberpass`). public_id
-- values and ids are hard-coded in e2e/src/scenarios/legal-page-agreement.ts.
--   tenant AgreTNNTAAA1 (agree.localhost / admin.agree.localhost)
--   admin  AgreADMNAAA1 (agree-admin@example.com)
--   reader AgreMMBRAAA1 (agree-member@example.com)

-- A tenant's audit entries hold its deletion back, so they go first.
DELETE FROM audit_logs
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'AgreTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'AgreTNNTAAA1';

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
    '018f10b0-0001-7000-8000-000000000001'::uuid,
    'AgreTNNTAAA1',
    'agree.localhost:' || :'tenant_port',
    'admin.agree.localhost:' || :'tenant_port',
    'Agreement Tenant',
    'active',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

INSERT INTO pages (id, tenant_id, slug)
VALUES
    (
        '018f10b0-0002-7000-8000-000000000001'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        '/terms'
    ),
    (
        '018f10b0-0002-7000-8000-000000000002'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        '/privacy'
    );

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
VALUES
    (
        '018f10b0-0004-7000-8000-000000000001'::uuid,
        '018f10b0-0002-7000-8000-000000000001'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        'en',
        'Terms of service'
    ),
    (
        '018f10b0-0004-7000-8000-000000000002'::uuid,
        '018f10b0-0002-7000-8000-000000000002'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        'en',
        'Privacy policy'
    );

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
VALUES
    (
        '018f10b0-0003-7000-8000-000000000001'::uuid,
        '018f10b0-0002-7000-8000-000000000001'::uuid,
        '018f10b0-0004-7000-8000-000000000001'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        1,
        E'## Terms\n\nThe terms of service the reader agreed to.',
        'published',
        NOW() - INTERVAL '1 day'
    ),
    (
        '018f10b0-0003-7000-8000-000000000002'::uuid,
        '018f10b0-0002-7000-8000-000000000001'::uuid,
        '018f10b0-0004-7000-8000-000000000001'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        2,
        E'## Terms\n\nThe revised terms of service.',
        'draft',
        NULL
    ),
    (
        '018f10b0-0003-7000-8000-000000000003'::uuid,
        '018f10b0-0002-7000-8000-000000000002'::uuid,
        '018f10b0-0004-7000-8000-000000000002'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        1,
        E'## Privacy\n\nThe privacy policy.',
        'published',
        NOW() - INTERVAL '1 day'
    );

UPDATE page_translations pt
SET published_version_id = seed.version_id
FROM (
    VALUES
        (
            '018f10b0-0004-7000-8000-000000000001'::uuid,
            '018f10b0-0003-7000-8000-000000000001'::uuid
        ),
        (
            '018f10b0-0004-7000-8000-000000000002'::uuid,
            '018f10b0-0003-7000-8000-000000000003'::uuid
        )
) AS seed (translation_id, version_id)
WHERE pt.id = seed.translation_id;

INSERT INTO tenant_config (tenant_id, terms_page_id, privacy_page_id)
VALUES (
    '018f10b0-0001-7000-8000-000000000001'::uuid,
    '018f10b0-0002-7000-8000-000000000001'::uuid,
    '018f10b0-0002-7000-8000-000000000002'::uuid
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
VALUES
    (
        '018f10b0-0005-7000-8000-000000000001'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        'AgreADMNAAA1',
        'agree-admin@example.com',
        '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
        'Agreement E2E Admin',
        'active',
        NOW()
    ),
    (
        '018f10b0-0005-7000-8000-000000000002'::uuid,
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        'AgreMMBRAAA1',
        'agree-member@example.com',
        '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
        'Agreement E2E Reader',
        'active',
        NOW()
    );

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
VALUES (
    '018f10b0-0006-7000-8000-000000000001'::uuid,
    '018f10b0-0005-7000-8000-000000000001'::uuid,
    'tenant_admin',
    '018f10b0-0001-7000-8000-000000000001'::uuid
);

INSERT INTO user_page_consents (tenant_id, user_id, page_version_id, agreed_at)
VALUES
    (
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        '018f10b0-0005-7000-8000-000000000002'::uuid,
        '018f10b0-0003-7000-8000-000000000001'::uuid,
        NOW() - INTERVAL '1 day'
    ),
    (
        '018f10b0-0001-7000-8000-000000000001'::uuid,
        '018f10b0-0005-7000-8000-000000000002'::uuid,
        '018f10b0-0003-7000-8000-000000000003'::uuid,
        NOW() - INTERVAL '1 day'
    );
