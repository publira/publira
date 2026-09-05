-- Scenario: a platform operator whose own account the operator-settings E2E may rewrite
--
-- `platform.operator-settings.spec.ts` moves this operator's email address and
-- saves a field of the shared platform SMTP settings. The development seed
-- super admin and the operators in `030_platform_operators.sql` cannot absorb
-- the address change: other suites sign in as those addresses. The SMTP save
-- is restored below so a leftover Reply-to cannot leak into a later run.
--
-- Applying it is also how the suite puts the account and the SMTP field back,
-- so every statement below either writes the starting value or deletes the
-- rows the suite creates. Password hash matches the dev seed (`platformpass`).
-- public_id values are hard-coded in e2e/src/scenarios/operator-settings.ts.
--   platform user AsetPFUSAAA1 (aset-platform@example.com)

WITH platform_user_seed AS (
    SELECT '018f0f51-0001-7000-8000-000000000001'::uuid AS id
)
INSERT INTO platform_users (id, public_id, email, password_hash, name, status)
SELECT
    pus.id,
    'AsetPFUSAAA1',
    'aset-platform@example.com',
    '$2a$10$iDBugdGIlP5aTi9E4HjDQeea05pSALsDUkIPq1D2ku/2AWUT40r6i',
    'Operator Settings E2E Operator',
    'active'
FROM platform_user_seed pus
ON CONFLICT (public_id) DO UPDATE
SET email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status;

INSERT INTO platform_user_roles (id, platform_user_id, role)
SELECT
    '018f0f51-0002-7000-8000-000000000001'::uuid,
    pu.id,
    'platform_operator'
FROM platform_users pu
WHERE pu.public_id = 'AsetPFUSAAA1'
ON CONFLICT (platform_user_id, role) DO NOTHING;

-- The suite changes Reply-to on the single platform SMTP row. Host and port
-- stay whatever `task e2e:db` pointed at Mailpit, so this restore must not
-- write those columns.
UPDATE platform_smtp_config
SET reply_to = 'support@platform.local',
    updated_at = NOW()
WHERE singleton;

-- A request the suite left behind stays confirmable until it expires, so the
-- link from one run could move the address again during the next one.
DELETE FROM platform_user_email_change_tokens
WHERE platform_user_id IN (
    SELECT id FROM platform_users WHERE public_id = 'AsetPFUSAAA1'
);
