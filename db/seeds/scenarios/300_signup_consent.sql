-- Scenario: a tenant that names its terms of service and privacy policy
--
-- `host.signup-consent.spec.ts` signs a reader up where the sign-up form asks
-- for consent to those two pages. The nomination is one setting for a whole
-- tenant, so the tenant that asks cannot be the development seed one, whose
-- sign-up `host.account-lifecycle.spec.ts` drives without a consent control.
--
-- The terms page has a superseded version before the published one, so the
-- version the suite reads back is not simply the page's only one.
--
-- A second tenant names one page as both its terms of service and its privacy
-- policy, which the sign-up form has to send as one version.
--
-- Applying it is also how the suite starts over: the tenants are deleted and
-- written again, which takes the accounts the sign-ups created and their
-- consent rows with them.
-- public_id values and version ids are hard-coded in
-- e2e/src/scenarios/signup-consent.ts.
--   tenant CnstTNNTAAA1 (consent.localhost / admin.consent.localhost)
--   tenant CnstTNNTAAA2 (shared-consent.localhost /
--     admin.shared-consent.localhost)

DELETE FROM tenants
WHERE public_id IN ('CnstTNNTAAA1', 'CnstTNNTAAA2');

WITH tenant_seed AS (
    SELECT '018f0ff0-0001-7000-8000-000000000001'::uuid AS id
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
    'CnstTNNTAAA1',
    'consent.localhost',
    'admin.consent.localhost',
    'Consent Tenant',
    'active',
    'en'
FROM tenant_seed ts;

INSERT INTO pages (id, tenant_id, slug)
SELECT seed.id, t.id, seed.slug
FROM (
    VALUES
        (
            '018f0ff0-0002-7000-8000-000000000001'::uuid,
            '/terms'
        ),
        (
            '018f0ff0-0002-7000-8000-000000000002'::uuid,
            '/privacy'
        )
) AS seed (id, slug)
JOIN tenants t ON t.public_id = 'CnstTNNTAAA1';

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
SELECT seed.id, seed.page_id, t.id, t.default_locale, seed.title
FROM (
    VALUES
        (
            '018f0ff0-0004-7000-8000-000000000001'::uuid,
            '018f0ff0-0002-7000-8000-000000000001'::uuid,
            'Terms of service'
        ),
        (
            '018f0ff0-0004-7000-8000-000000000002'::uuid,
            '018f0ff0-0002-7000-8000-000000000002'::uuid,
            'Privacy policy'
        )
) AS seed (id, page_id, title)
JOIN tenants t ON t.public_id = 'CnstTNNTAAA1';

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
    seed.id,
    pt.page_id,
    pt.id,
    t.id,
    seed.version_number,
    seed.content_markdown,
    'published',
    NOW()
FROM (
    VALUES
        (
            '018f0ff0-0003-7000-8000-000000000001'::uuid,
            '018f0ff0-0004-7000-8000-000000000001'::uuid,
            1,
            E'## Terms\n\nThe first terms of service.'
        ),
        (
            '018f0ff0-0003-7000-8000-000000000002'::uuid,
            '018f0ff0-0004-7000-8000-000000000001'::uuid,
            2,
            E'## Terms\n\nThe revised terms of service.'
        ),
        (
            '018f0ff0-0003-7000-8000-000000000003'::uuid,
            '018f0ff0-0004-7000-8000-000000000002'::uuid,
            1,
            E'## Privacy\n\nThe privacy policy.'
        )
) AS seed (id, translation_id, version_number, content_markdown)
JOIN page_translations pt ON pt.id = seed.translation_id
JOIN tenants t ON t.id = pt.tenant_id;

UPDATE page_translations pt
SET published_version_id = seed.version_id
FROM (
    VALUES
        (
            '018f0ff0-0004-7000-8000-000000000001'::uuid,
            '018f0ff0-0003-7000-8000-000000000002'::uuid
        ),
        (
            '018f0ff0-0004-7000-8000-000000000002'::uuid,
            '018f0ff0-0003-7000-8000-000000000003'::uuid
        )
) AS seed (translation_id, version_id)
WHERE pt.id = seed.translation_id;

INSERT INTO tenant_config (tenant_id, terms_page_id, privacy_page_id)
SELECT
    t.id,
    '018f0ff0-0002-7000-8000-000000000001'::uuid,
    '018f0ff0-0002-7000-8000-000000000002'::uuid
FROM tenants t
WHERE t.public_id = 'CnstTNNTAAA1';

INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    default_locale
)
VALUES (
    '018f0ff0-0001-7000-8000-000000000002'::uuid,
    'CnstTNNTAAA2',
    'shared-consent.localhost',
    'admin.shared-consent.localhost',
    'Shared Consent Tenant',
    'active',
    'en'
);

INSERT INTO pages (id, tenant_id, slug)
VALUES (
    '018f0ff0-0002-7000-8000-000000000003'::uuid,
    '018f0ff0-0001-7000-8000-000000000002'::uuid,
    '/legal'
);

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
VALUES (
    '018f0ff0-0004-7000-8000-000000000003'::uuid,
    '018f0ff0-0002-7000-8000-000000000003'::uuid,
    '018f0ff0-0001-7000-8000-000000000002'::uuid,
    'en',
    'Terms and privacy'
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
VALUES (
    '018f0ff0-0003-7000-8000-000000000004'::uuid,
    '018f0ff0-0002-7000-8000-000000000003'::uuid,
    '018f0ff0-0004-7000-8000-000000000003'::uuid,
    '018f0ff0-0001-7000-8000-000000000002'::uuid,
    1,
    E'## Terms and privacy\n\nThe terms of service and the privacy policy.',
    'published',
    NOW()
);

UPDATE page_translations
SET published_version_id = '018f0ff0-0003-7000-8000-000000000004'::uuid
WHERE id = '018f0ff0-0004-7000-8000-000000000003'::uuid;

INSERT INTO tenant_config (tenant_id, terms_page_id, privacy_page_id)
VALUES (
    '018f0ff0-0001-7000-8000-000000000002'::uuid,
    '018f0ff0-0002-7000-8000-000000000003'::uuid,
    '018f0ff0-0002-7000-8000-000000000003'::uuid
);
