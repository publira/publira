-- pages seed: sample privacy policy and terms of service
WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.public_id = 'SeedTNNTAAA1'
    LIMIT 1
)
INSERT INTO pages (id, tenant_id, slug)
SELECT
    '018f1000-0001-7000-8000-000000000001'::uuid,
    ts.tenant_id,
    '/privacy'
FROM tenant_scope ts
ON CONFLICT (tenant_id, slug) DO NOTHING;

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
SELECT
    '018f1000-0007-7000-8000-000000000001'::uuid,
    p.id,
    p.tenant_id,
    t.default_locale,
    'Privacy policy'
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
WHERE t.public_id = 'SeedTNNTAAA1'
  AND p.slug = '/privacy'
ON CONFLICT (page_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    updated_at = NOW();

UPDATE page_versions pv
SET page_id = p.id,
    translation_id = pt.id,
    tenant_id = p.tenant_id,
    version_number = 1,
    content_markdown = E'## What we collect\n\nWe collect the minimum personal information needed to register an account and to run the service.\n\n## How we use it\n\nWe use the information we collect only for the purposes below.\n\n- Providing and operating the service\n- Sending notices and other messages to users\n- Statistical analysis that helps us improve the service\n\n## Sharing with third parties\n\nWe do not share personal information with third parties except where the law requires it.\n\n## Contact\n\nPlease contact support with any question about privacy.',
    author_user_id = (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    status = 'published',
    published_at = NOW()
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN page_translations pt ON pt.page_id = p.id
        AND pt.locale = t.default_locale
WHERE pv.id = '018f1000-0002-7000-8000-000000000001'::uuid
  AND p.slug = '/privacy'
  AND p.tenant_id = pv.tenant_id;

INSERT INTO page_versions (id, page_id, translation_id, tenant_id, version_number, content_markdown, author_user_id, status, published_at)
SELECT
    '018f1000-0002-7000-8000-000000000001'::uuid,
    p.id,
    pt.id,
    p.tenant_id,
    1,
    E'## What we collect\n\nWe collect the minimum personal information needed to register an account and to run the service.\n\n## How we use it\n\nWe use the information we collect only for the purposes below.\n\n- Providing and operating the service\n- Sending notices and other messages to users\n- Statistical analysis that helps us improve the service\n\n## Sharing with third parties\n\nWe do not share personal information with third parties except where the law requires it.\n\n## Contact\n\nPlease contact support with any question about privacy.',
    (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    'published',
    NOW()
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN page_translations pt ON pt.page_id = p.id
        AND pt.locale = t.default_locale
WHERE p.slug = '/privacy'
  AND t.public_id = 'SeedTNNTAAA1'
  AND NOT EXISTS (
      SELECT 1
      FROM page_versions pv
      WHERE pv.id = '018f1000-0002-7000-8000-000000000001'::uuid
  );

UPDATE page_translations pt
SET published_version_id = '018f1000-0002-7000-8000-000000000001'::uuid
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
WHERE pt.page_id = p.id
  AND pt.locale = t.default_locale
  AND p.slug = '/privacy'
  AND t.public_id = 'SeedTNNTAAA1';

UPDATE pages
SET display_in_footer = true
WHERE slug = '/privacy'
  AND tenant_id IN (
      SELECT t.id
      FROM tenants t
      WHERE t.public_id = 'SeedTNNTAAA1'
  );

WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.public_id = 'SeedTNNTAAA1'
    LIMIT 1
)
INSERT INTO pages (id, tenant_id, slug)
SELECT
    '018f1000-0003-7000-8000-000000000001'::uuid,
    ts.tenant_id,
    '/terms'
FROM tenant_scope ts
ON CONFLICT (tenant_id, slug) DO NOTHING;

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
SELECT
    '018f1000-0007-7000-8000-000000000002'::uuid,
    p.id,
    p.tenant_id,
    t.default_locale,
    'Terms of service'
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
WHERE t.public_id = 'SeedTNNTAAA1'
  AND p.slug = '/terms'
ON CONFLICT (page_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    updated_at = NOW();

UPDATE page_versions pv
SET page_id = p.id,
    translation_id = pt.id,
    tenant_id = p.tenant_id,
    version_number = 1,
    content_markdown = E'## Article 1 (Scope)\n\nThese terms set out the conditions for using the service. Use the service only if you agree to them.\n\n## Article 2 (Registration)\n\nRegistration is complete once you have filled in the registration form and the operator has approved it.\n\n## Article 3 (Prohibited conduct)\n\nThe following is prohibited.\n\n- Conduct that breaks the law or public order\n- Conduct that interferes with the operation of the service\n- Conduct that troubles other users\n\n## Article 4 (Disclaimer)\n\nThe operator accepts no liability for damages arising from use of the service.\n\n## Article 5 (Changes to these terms)\n\nThe operator may change these terms as needed. A change takes effect once it is published on the service.',
    author_user_id = (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    status = 'published',
    published_at = NOW()
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN page_translations pt ON pt.page_id = p.id
        AND pt.locale = t.default_locale
WHERE pv.id = '018f1000-0004-7000-8000-000000000001'::uuid
  AND p.slug = '/terms'
  AND p.tenant_id = pv.tenant_id;

INSERT INTO page_versions (id, page_id, translation_id, tenant_id, version_number, content_markdown, author_user_id, status, published_at)
SELECT
    '018f1000-0004-7000-8000-000000000001'::uuid,
    p.id,
    pt.id,
    p.tenant_id,
    1,
    E'## Article 1 (Scope)\n\nThese terms set out the conditions for using the service. Use the service only if you agree to them.\n\n## Article 2 (Registration)\n\nRegistration is complete once you have filled in the registration form and the operator has approved it.\n\n## Article 3 (Prohibited conduct)\n\nThe following is prohibited.\n\n- Conduct that breaks the law or public order\n- Conduct that interferes with the operation of the service\n- Conduct that troubles other users\n\n## Article 4 (Disclaimer)\n\nThe operator accepts no liability for damages arising from use of the service.\n\n## Article 5 (Changes to these terms)\n\nThe operator may change these terms as needed. A change takes effect once it is published on the service.',
    (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    'published',
    NOW()
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN page_translations pt ON pt.page_id = p.id
        AND pt.locale = t.default_locale
WHERE p.slug = '/terms'
  AND t.public_id = 'SeedTNNTAAA1'
  AND NOT EXISTS (
      SELECT 1
      FROM page_versions pv
      WHERE pv.id = '018f1000-0004-7000-8000-000000000001'::uuid
  );

UPDATE page_translations pt
SET published_version_id = '018f1000-0004-7000-8000-000000000001'::uuid
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
WHERE pt.page_id = p.id
  AND pt.locale = t.default_locale
  AND p.slug = '/terms'
  AND t.public_id = 'SeedTNNTAAA1';

UPDATE pages
SET display_in_footer = true
WHERE slug = '/terms'
  AND tenant_id IN (
      SELECT t.id
      FROM tenants t
      WHERE t.public_id = 'SeedTNNTAAA1'
  );

-- Multi-segment slug sample for /legal/terms public URL coverage
WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.public_id = 'SeedTNNTAAA1'
    LIMIT 1
)
INSERT INTO pages (id, tenant_id, slug)
SELECT
    '018f1000-0005-7000-8000-000000000001'::uuid,
    ts.tenant_id,
    '/legal/terms'
FROM tenant_scope ts
ON CONFLICT (tenant_id, slug) DO NOTHING;

INSERT INTO page_translations (id, page_id, tenant_id, locale, title)
SELECT
    '018f1000-0007-7000-8000-000000000003'::uuid,
    p.id,
    p.tenant_id,
    t.default_locale,
    'Nested slug test'
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
WHERE t.public_id = 'SeedTNNTAAA1'
  AND p.slug = '/legal/terms'
ON CONFLICT (page_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    updated_at = NOW();

UPDATE page_versions pv
SET page_id = p.id,
    translation_id = pt.id,
    tenant_id = p.tenant_id,
    version_number = 1,
    content_markdown = E'## Nested slug test\n\nIf `/legal/terms` renders, this works.',
    author_user_id = (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    status = 'published',
    published_at = NOW()
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN page_translations pt ON pt.page_id = p.id
        AND pt.locale = t.default_locale
WHERE pv.id = '018f1000-0006-7000-8000-000000000001'::uuid
  AND p.slug = '/legal/terms'
  AND p.tenant_id = pv.tenant_id;

INSERT INTO page_versions (id, page_id, translation_id, tenant_id, version_number, content_markdown, author_user_id, status, published_at)
SELECT
    '018f1000-0006-7000-8000-000000000001'::uuid,
    p.id,
    pt.id,
    p.tenant_id,
    1,
    E'## Nested slug test\n\nIf `/legal/terms` renders, this works.',
    (
        SELECT u.id
        FROM users u
        WHERE u.email = 'admin@example.com'
          AND u.tenant_id = p.tenant_id
        ORDER BY u.created_at ASC
        LIMIT 1
    ),
    'published',
    NOW()
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
    JOIN page_translations pt ON pt.page_id = p.id
        AND pt.locale = t.default_locale
WHERE p.slug = '/legal/terms'
  AND t.public_id = 'SeedTNNTAAA1'
  AND NOT EXISTS (
      SELECT 1
      FROM page_versions pv
      WHERE pv.id = '018f1000-0006-7000-8000-000000000001'::uuid
  );

UPDATE page_translations pt
SET published_version_id = '018f1000-0006-7000-8000-000000000001'::uuid
FROM pages p
    JOIN tenants t ON t.id = p.tenant_id
WHERE pt.page_id = p.id
  AND pt.locale = t.default_locale
  AND p.slug = '/legal/terms'
  AND t.public_id = 'SeedTNNTAAA1';
