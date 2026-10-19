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
-- tenants' site copy follows the same pattern, and so do the bilingual
-- tenant's two genres, the first of which the first series carries, and its
-- two announcements, at the end of this file.
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
--   genre    BLNGGENRAAA1 (Japanese and English, on BlngSERSAAA1) / BLNGGENRAAA2 (Japanese)
--   announcement 018f0f46-0001-… (Japanese and English) / 018f0f46-0002-… (Japanese)

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

-- Two genres of the bilingual tenant: the first named in Japanese and English
-- and carried by the first series, so its badge changes language with the
-- series page, and the second named in Japanese alone, so its English URL
-- falls back. A slug is derived from the default locale's name. Their public
-- IDs are spelled in capitals because a genre page refuses an ID outside
-- Base58, which has no lowercase L.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'BlngTNNTAAA1'
),
genre_seed (id, public_id, slug, display_order) AS (
    VALUES
        ('018f0f47-0001-7000-8000-000000000001'::uuid, 'BLNGGENRAAA1', 'journeys-japanese-edition', 1),
        ('018f0f47-0002-7000-8000-000000000002'::uuid, 'BLNGGENRAAA2', 'harbors-japanese-edition', 2)
)
INSERT INTO genres (id, tenant_id, public_id, slug, display_order)
SELECT
    gs.id,
    ts.id,
    gs.public_id,
    gs.slug,
    gs.display_order
FROM genre_seed gs
CROSS JOIN tenant_scope ts
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    slug = EXCLUDED.slug,
    display_order = EXCLUDED.display_order;

WITH translation_seed (id, genre_id, locale, name) AS (
    VALUES
        (
            '018f0f48-0001-7000-8000-000000000001'::uuid,
            '018f0f47-0001-7000-8000-000000000001'::uuid,
            'ja',
            'Journeys (Japanese edition)'
        ),
        (
            '018f0f48-0002-7000-8000-000000000002'::uuid,
            '018f0f47-0001-7000-8000-000000000001'::uuid,
            'en',
            'Journeys'
        ),
        (
            '018f0f48-0003-7000-8000-000000000003'::uuid,
            '018f0f47-0002-7000-8000-000000000002'::uuid,
            'ja',
            'Harbors (Japanese edition)'
        )
)
INSERT INTO genre_translations (id, genre_id, tenant_id, locale, name)
SELECT
    tr.id,
    g.id,
    g.tenant_id,
    tr.locale,
    tr.name
FROM translation_seed tr
JOIN genres g ON g.id = tr.genre_id
ON CONFLICT (genre_id, locale) DO UPDATE
SET name = EXCLUDED.name;

INSERT INTO series_genres (tenant_id, series_id, genre_id)
SELECT
    s.tenant_id,
    s.id,
    '018f0f47-0001-7000-8000-000000000001'::uuid
FROM series s
WHERE s.id = '018f0f42-0001-7000-8000-000000000001'::uuid
ON CONFLICT (series_id, genre_id) DO NOTHING;

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

-- Two announcements of the bilingual tenant, read on the public site without a
-- session: the first written in Japanese and English, the second in Japanese
-- alone, so its English URL falls back. The second is the older, so the list
-- shows the first above it.
WITH tenant_scope AS (
    SELECT t.id
    FROM tenants t
    WHERE t.public_id = 'BlngTNNTAAA1'
),
announcement_seed (id, created_at) AS (
    VALUES
        ('018f0f46-0001-7000-8000-000000000001'::uuid, NOW() - INTERVAL '1 day'),
        ('018f0f46-0002-7000-8000-000000000002'::uuid, NOW() - INTERVAL '2 days')
)
INSERT INTO announcements (id, tenant_id, announcement_type, created_at)
SELECT
    a.id,
    ts.id,
    'announcement',
    a.created_at
FROM announcement_seed a
CROSS JOIN tenant_scope ts
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    announcement_type = EXCLUDED.announcement_type,
    created_at = EXCLUDED.created_at;

WITH translation_seed (announcement_id, locale, title, body) AS (
    VALUES
        (
            '018f0f46-0001-7000-8000-000000000001'::uuid,
            'ja',
            'Spring schedule (Japanese edition)',
            'The Japanese body of the spring schedule.'
        ),
        (
            '018f0f46-0001-7000-8000-000000000001'::uuid,
            'en',
            'Spring schedule',
            'The English body of the spring schedule.'
        ),
        (
            '018f0f46-0002-7000-8000-000000000002'::uuid,
            'ja',
            'Maintenance window (Japanese edition)',
            'The Japanese body of the maintenance window.'
        )
)
INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
SELECT
    uuidv7(),
    a.id,
    a.tenant_id,
    tr.locale,
    tr.title,
    tr.body
FROM translation_seed tr
JOIN announcements a ON a.id = tr.announcement_id
ON CONFLICT (announcement_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    body = EXCLUDED.body;
