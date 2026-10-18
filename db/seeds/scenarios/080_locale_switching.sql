-- Scenario: a tenant whose stored default locale is Japanese
--
-- Every other seeded tenant saves `en`, so a suite reading one of them cannot
-- tell "the tenant's stored default" apart from "a constant this build falls
-- back to". This tenant saves `ja` and nothing else, which is what makes the
-- prefix rules readable in both directions: `locale.localhost` serves Japanese
-- with no prefix and keeps `/en/...`, while the development seed tenant does
-- the mirror image of that.
--
-- A second tenant, `bilingual.localhost`, offers Japanese and English alone,
-- Japanese being its default, so the same suite can tell the languages a
-- tenant offers apart from the registry: a prefix it does not offer redirects
-- to the unprefixed path, and the switcher, the sitemap, robots.txt, and the
-- app-association document name its two languages only.
--
-- The bilingual tenant also publishes two series, so the suite can read a
-- title in the reader's language and one that falls back: the first is
-- written in Japanese and English, its episode too, and the second in Japanese
-- alone. The Japanese titles are English text marked as the Japanese edition,
-- which is all the suite needs to tell the two translations apart. The
-- tenants' site copy follows the same pattern, at the end of this file.
--
-- The public site and the console login screen are both reached without a
-- session, so neither tenant owns users, and the Japanese-default tenant owns
-- no series either: its series list is asserted empty. public_id values are
-- hard-coded in e2e/src/scenarios/locale-switching.ts.
--   tenant   LangTNNTAAA1 (locale.localhost / admin.locale.localhost)
--   tenant   BlngTNNTAAA1 (bilingual.localhost / admin.bilingual.localhost)
--   label    BlngLABLAAA1
--   series   BlngSERSAAA1 (Japanese and English) / BlngSERSAAA2 (Japanese)
--   episode  BlngEPSDAAA1 (of BlngSERSAAA1, Japanese and English)

WITH tenant_seed AS (
    SELECT '018f0f40-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale, supported_locales)
SELECT
    ts.id,
    'LangTNNTAAA1',
    'locale.localhost:' || :'tenant_port',
    'admin.locale.localhost:' || :'tenant_port',
    'Locale Tenant',
    'active',
    'ja',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale,
    supported_locales = EXCLUDED.supported_locales;

\set seed_tenant LangTNNTAAA1
\ir ../creator_roles.sql

WITH tenant_seed AS (
    SELECT '018f0f40-0001-7000-8000-000000000002'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale, supported_locales)
SELECT
    ts.id,
    'BlngTNNTAAA1',
    'bilingual.localhost:' || :'tenant_port',
    'admin.bilingual.localhost:' || :'tenant_port',
    'Bilingual Tenant',
    'active',
    'ja',
    ARRAY['ja', 'en']
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale,
    supported_locales = EXCLUDED.supported_locales;

\set seed_tenant BlngTNNTAAA1
\ir ../creator_roles.sql

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'BlngTNNTAAA1'
)
INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f0f41-0001-7000-8000-000000000001'::uuid,
    ts.id,
    'BlngLABLAAA1',
    'Bilingual Label'
FROM tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'BlngTNNTAAA1'
),
series_seed (id, public_id) AS (
    VALUES
        ('018f0f42-0001-7000-8000-000000000001'::uuid, 'BlngSERSAAA1'),
        ('018f0f42-0002-7000-8000-000000000002'::uuid, 'BlngSERSAAA2')
)
INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    ss.id,
    ts.id,
    '018f0f41-0001-7000-8000-000000000001'::uuid,
    ss.public_id,
    true,
    NOW() - INTERVAL '3 days'
FROM series_seed ss
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    label_id = EXCLUDED.label_id,
    is_published = EXCLUDED.is_published,
    published_at = EXCLUDED.published_at,
    updated_at = NOW();

WITH translation_seed (id, series_id, locale, title, synopsis) AS (
    VALUES
        (
            '018f0f43-0001-7000-8000-000000000001'::uuid,
            '018f0f42-0001-7000-8000-000000000001'::uuid,
            'ja',
            'Night Train (Japanese edition)',
            'The Japanese synopsis of Night Train.'
        ),
        (
            '018f0f43-0002-7000-8000-000000000002'::uuid,
            '018f0f42-0001-7000-8000-000000000001'::uuid,
            'en',
            'Night Train',
            'The English synopsis of Night Train.'
        ),
        (
            '018f0f43-0003-7000-8000-000000000003'::uuid,
            '018f0f42-0002-7000-8000-000000000002'::uuid,
            'ja',
            'Harbor Lights (Japanese edition)',
            'The Japanese synopsis of Harbor Lights.'
        )
)
INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    tr.id,
    s.id,
    s.tenant_id,
    tr.locale,
    tr.title,
    tr.synopsis
FROM translation_seed tr
JOIN series s ON s.id = tr.series_id
ON CONFLICT (series_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    synopsis = EXCLUDED.synopsis;

INSERT INTO series_listings (series_id, reading_period_hours, tenant_id)
SELECT
    s.id,
    72,
    s.tenant_id
FROM series s
WHERE s.id IN (
        '018f0f42-0001-7000-8000-000000000001'::uuid,
        '018f0f42-0002-7000-8000-000000000002'::uuid
    )
ON CONFLICT (series_id) DO UPDATE
SET reading_period_hours = EXCLUDED.reading_period_hours,
    tenant_id = EXCLUDED.tenant_id;

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    '018f0f44-0001-7000-8000-000000000001'::uuid,
    s.id,
    'BlngEPSDAAA1',
    1,
    s.tenant_id
FROM series s
WHERE s.id = '018f0f42-0001-7000-8000-000000000001'::uuid
ON CONFLICT (public_id) DO UPDATE
SET series_id = EXCLUDED.series_id,
    order_index = EXCLUDED.order_index,
    tenant_id = EXCLUDED.tenant_id;

WITH translation_seed (id, locale, title) AS (
    VALUES
        ('018f0f45-0001-7000-8000-000000000001'::uuid, 'ja', 'Departure (Japanese edition)'),
        ('018f0f45-0002-7000-8000-000000000002'::uuid, 'en', 'Departure')
)
INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    tr.id,
    e.id,
    e.tenant_id,
    tr.locale,
    tr.title
FROM translation_seed tr
JOIN episodes e ON e.id = '018f0f44-0001-7000-8000-000000000001'::uuid
ON CONFLICT (episode_id, locale) DO UPDATE
SET title = EXCLUDED.title;

-- Free, so the episode page opens for a reader without a session.
INSERT INTO episode_listings (
    episode_id,
    price,
    reading_period_hours,
    status,
    scheduled_at,
    published_at,
    tenant_id
)
SELECT
    e.id,
    0,
    72,
    'published',
    NULL::timestamptz,
    NOW() - INTERVAL '2 days',
    e.tenant_id
FROM episodes e
WHERE e.id = '018f0f44-0001-7000-8000-000000000001'::uuid
ON CONFLICT (episode_id) DO UPDATE
SET price = EXCLUDED.price,
    reading_period_hours = EXCLUDED.reading_period_hours,
    status = EXCLUDED.status,
    scheduled_at = EXCLUDED.scheduled_at,
    published_at = EXCLUDED.published_at,
    tenant_id = EXCLUDED.tenant_id;

-- The site copy, written per locale. The bilingual tenant writes it in
-- Japanese and English, so its footer and description change with the URL's
-- language; the Japanese-default tenant writes it in Japanese alone, so its
-- `/en/...` falls back to the Japanese copy.
WITH copy_seed (tenant_public_id, locale, site_tagline, site_description, copyright_text) AS (
    VALUES
        (
            'BlngTNNTAAA1',
            'ja',
            'Stories in two languages (Japanese edition)',
            'The Japanese description of Bilingual Tenant.',
            '© Bilingual Tenant (Japanese edition)'
        ),
        (
            'BlngTNNTAAA1',
            'en',
            'Stories in two languages',
            'The English description of Bilingual Tenant.',
            '© Bilingual Tenant'
        ),
        (
            'LangTNNTAAA1',
            'ja',
            'Stories in every language (Japanese edition)',
            'The Japanese description of Locale Tenant.',
            '© Locale Tenant (Japanese edition)'
        )
)
INSERT INTO tenant_config_translations (
    id,
    tenant_id,
    locale,
    site_tagline,
    site_description,
    copyright_text
)
SELECT
    uuidv7(),
    t.id,
    cs.locale,
    cs.site_tagline,
    cs.site_description,
    cs.copyright_text
FROM copy_seed cs
JOIN tenants t ON t.public_id = cs.tenant_public_id
ON CONFLICT (tenant_id, locale) DO UPDATE
SET site_tagline = EXCLUDED.site_tagline,
    site_description = EXCLUDED.site_description,
    copyright_text = EXCLUDED.copyright_text,
    updated_at = NOW();
