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
-- The public site and the console login screen are both reached without a
-- session, so neither tenant owns series or users. public_id values are
-- hard-coded in e2e/src/scenarios/locale-switching.ts.
--   tenant LangTNNTAAA1 (locale.localhost / admin.locale.localhost)
--   tenant BlngTNNTAAA1 (bilingual.localhost / admin.bilingual.localhost)

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
