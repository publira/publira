-- Scenario: a member whose own account the settings E2E may rewrite
--
-- `host.member-settings.spec.ts` renames the reader, turns their email
-- notifications off, submits an email change, and follows a series. The dev
-- seed member cannot absorb that: `host.auth` signs in with its address,
-- `announcements.pagination` reads its announcement list, and both run beside
-- this suite under `workers: 3`.
--
-- Applying this file is also how the suite restores what it changed, so every
-- statement below either writes the starting value or deletes the rows the
-- suite creates. Password hash matches the dev seed (`memberpass`).
-- public_id values are hard-coded in e2e/src/scenarios/member-settings.ts.
--   member MsetMMBRAAA1 (settings-member@example.com)

WITH member_user_seed AS (
    SELECT '018f0f30-0001-7000-8000-000000000001'::uuid AS id
)
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
SELECT
    mus.id,
    t.id,
    'MsetMMBRAAA1',
    'settings-member@example.com',
    '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
    'Settings E2E Member',
    'active',
    NOW()
FROM member_user_seed mus
JOIN tenants t ON t.domain = 'localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

-- No row means the API's own default, which is what the screen opens on. The
-- suite writes one by saving the notification form.
DELETE FROM user_notification_settings
WHERE user_id IN (SELECT id FROM users WHERE public_id = 'MsetMMBRAAA1');

-- The follow list starts empty: the suite follows a series through the series
-- page and asserts the entry appears, so a leftover row would pass without the
-- round trip having happened.
DELETE FROM series_follows
WHERE user_id IN (SELECT id FROM users WHERE public_id = 'MsetMMBRAAA1');

DELETE FROM creator_follows
WHERE user_id IN (SELECT id FROM users WHERE public_id = 'MsetMMBRAAA1');

DELETE FROM user_email_change_tokens
WHERE user_id IN (SELECT id FROM users WHERE public_id = 'MsetMMBRAAA1');
