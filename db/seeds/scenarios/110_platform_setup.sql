-- Scenario: put the platform back the way the development seed leaves it.
--
-- `e2e/tests/platform.setup.spec.ts` drives `/setup`, which only renders while
-- the platform has no operator at all, so the spec empties `platform_users`
-- first (`emptyPlatformOperators()` in `e2e/src/db.ts`) and the first operator
-- it then creates through the form is not the seeded one. This file is what it
-- applies afterwards, whether it passed or failed: it removes the operator the
-- form created and re-inserts the development seed's platform rows, so the rest
-- of the suite finds `platform@example.com` and a saved default language again.
--
-- The rows and their fixed ids match `db/seeds/dev/001_tenant_users.sql`; the
-- email below matches `e2e/src/scenarios/platform-setup.ts`. The scenario
-- accounts of `030_platform_operators.sql` and `040_auth_e2e.sql` are not
-- re-inserted here: the specs that sign in as them apply their own file.
--   platform user  SeedPFUSAAA1

-- `platform_audit_logs.actor_platform_user_id` restricts rather than cascades,
-- so anything the created operator did has to go before the operator does.
DELETE FROM platform_audit_logs
WHERE actor_platform_user_id IN (
        SELECT pu.id
        FROM platform_users pu
        WHERE pu.email = 'setup-operator@example.com'
    );

DELETE FROM platform_users
WHERE email = 'setup-operator@example.com';

INSERT INTO platform_config (singleton, default_timezone, default_locale)
VALUES (TRUE, 'Asia/Tokyo', 'en')
ON CONFLICT (singleton) DO UPDATE
SET default_timezone = EXCLUDED.default_timezone,
    default_locale = EXCLUDED.default_locale,
    updated_at = NOW();

WITH platform_user_seed AS (
    SELECT '018f0e6b-1000-7000-8000-000000000001'::uuid AS id
)
INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
SELECT
    pus.id,
    'SeedPFUSAAA1',
    'platform@example.com',
    '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
    'Platform Operator',
    'active'
FROM platform_user_seed pus
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    '018f0e6c-1000-7000-8000-000000000001'::uuid,
    pu.id,
    'platform_super_admin'
FROM platform_users pu
WHERE pu.email = 'platform@example.com'
ON CONFLICT (platform_user_id, role) DO NOTHING;
