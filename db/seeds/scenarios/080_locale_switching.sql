-- Scenario: a tenant whose stored default locale is English
--
-- Every other seeded tenant saves `ja`, so a suite reading one of them cannot
-- tell "the tenant's stored default" apart from "a constant this build falls
-- back to". This tenant saves `en` and nothing else, which is what makes the
-- prefix rules readable in both directions: `locale.localhost` serves English
-- with no prefix and keeps `/ja/...`, while the development seed tenant does
-- the mirror image of that.
--
-- The public site and the console login screen are both reached without a
-- session, so the tenant owns no series and no users. public_id values are
-- hard-coded in e2e/src/scenarios/locale-switching.ts.
--   tenant LangTNNTAAA1 (locale.localhost / admin.locale.localhost)

WITH tenant_seed AS (
    SELECT '018f0f40-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO tenants (id, public_id, domain, admin_domain, name, status, default_locale)
SELECT
    ts.id,
    'LangTNNTAAA1',
    'locale.localhost',
    'admin.locale.localhost',
    'Locale Tenant',
    'active',
    'en'
FROM tenant_seed ts
ON CONFLICT (public_id) DO UPDATE
SET domain = EXCLUDED.domain,
    admin_domain = EXCLUDED.admin_domain,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    default_locale = EXCLUDED.default_locale;
