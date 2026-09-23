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

INSERT INTO pages (id, tenant_id, slug, title)
SELECT seed.id, t.id, seed.slug, seed.title
FROM (
    VALUES
        (
            '018f0ff0-0002-7000-8000-000000000001'::uuid,
            '/terms',
            'Terms of service'
        ),
        (
            '018f0ff0-0002-7000-8000-000000000002'::uuid,
            '/privacy',
            'Privacy policy'
        )
) AS seed (id, slug, title)
JOIN tenants t ON t.public_id = 'CnstTNNTAAA1';

INSERT INTO page_versions (
    id,
    page_id,
    tenant_id,
    version_number,
    content_markdown,
    status,
    published_at
)
SELECT
    seed.id,
    seed.page_id,
    t.id,
    seed.version_number,
    seed.content_markdown,
    'published',
    NOW()
FROM (
    VALUES
        (
            '018f0ff0-0003-7000-8000-000000000001'::uuid,
            '018f0ff0-0002-7000-8000-000000000001'::uuid,
            1,
            E'## Terms\n\nThe first terms of service.'
        ),
        (
            '018f0ff0-0003-7000-8000-000000000002'::uuid,
            '018f0ff0-0002-7000-8000-000000000001'::uuid,
            2,
            E'## Terms\n\nThe revised terms of service.'
        ),
        (
            '018f0ff0-0003-7000-8000-000000000003'::uuid,
            '018f0ff0-0002-7000-8000-000000000002'::uuid,
            1,
            E'## Privacy\n\nThe privacy policy.'
        )
) AS seed (id, page_id, version_number, content_markdown)
JOIN tenants t ON t.public_id = 'CnstTNNTAAA1';

UPDATE pages p
SET published_version_id = seed.version_id
FROM (
    VALUES
        (
            '018f0ff0-0002-7000-8000-000000000001'::uuid,
            '018f0ff0-0003-7000-8000-000000000002'::uuid
        ),
        (
            '018f0ff0-0002-7000-8000-000000000002'::uuid,
            '018f0ff0-0003-7000-8000-000000000003'::uuid
        )
) AS seed (page_id, version_id)
WHERE p.id = seed.page_id;

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

INSERT INTO pages (id, tenant_id, slug, title)
VALUES (
    '018f0ff0-0002-7000-8000-000000000003'::uuid,
    '018f0ff0-0001-7000-8000-000000000002'::uuid,
    '/legal',
    'Terms and privacy'
);

INSERT INTO page_versions (
    id,
    page_id,
    tenant_id,
    version_number,
    content_markdown,
    status,
    published_at
)
VALUES (
    '018f0ff0-0003-7000-8000-000000000004'::uuid,
    '018f0ff0-0002-7000-8000-000000000003'::uuid,
    '018f0ff0-0001-7000-8000-000000000002'::uuid,
    1,
    E'## Terms and privacy\n\nThe terms of service and the privacy policy.',
    'published',
    NOW()
);

UPDATE pages
SET published_version_id = '018f0ff0-0003-7000-8000-000000000004'::uuid
WHERE id = '018f0ff0-0002-7000-8000-000000000003'::uuid;

INSERT INTO tenant_config (tenant_id, terms_page_id, privacy_page_id)
VALUES (
    '018f0ff0-0001-7000-8000-000000000002'::uuid,
    '018f0ff0-0002-7000-8000-000000000003'::uuid,
    '018f0ff0-0002-7000-8000-000000000003'::uuid
);
