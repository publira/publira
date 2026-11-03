-- Scenario: an unread announcement and an unread notification for the seed
-- member, and an announcement delivered to the member alone, read by the
-- mobile app over the live API
--
-- The development seed posts no announcement and delivers the member no
-- notification, so a live test of the app's inbox and announcement list could
-- only prove that the reads were answered. With one of each, the app's live
-- group opens them and asks the API whether the read mark it sent landed: the
-- same record the storefront reads back for the same account.
--
-- The targeted announcement is addressed to the followers of Seed Series 011,
-- which the member follows and the creator reader of `320_creator_reader.sql`
-- does not, and is written as the worker leaves one it has delivered: with
-- the member's notification row and nobody else's. Holding that row is what
-- lets a reader see it, so the live group can show it listed and opened for
-- the member, and absent for a visitor and for the creator reader.
--
-- Applied by `mobile/scripts/e2e-db-setup.sh` rather than for the whole E2E
-- stack: the Playwright suites read the seed tenant's announcements and the
-- member's bell, and a row they do not expect would move what they assert.
--
-- Re-applying it puts the rows back to unread. The notifications are deleted
-- and written again, because their natural key (member, type, subject) is what
-- a published episode and a delivery would also write.
--
-- ID band: 018f1010-0001-7000-8000-0000000000NN. The ids are constants in
-- mobile/test/support/connect_fixture_server.dart.

WITH target AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.public_id = 'SeedTNNTAAA1'
)
INSERT INTO announcements (
    id,
    tenant_id,
    announcement_type,
    created_at
)
SELECT
    '018f1010-0001-7000-8000-000000000001'::uuid,
    target.tenant_id,
    'system',
    NOW()
FROM target
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    announcement_type = EXCLUDED.announcement_type,
    created_at = EXCLUDED.created_at;

INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
SELECT
    uuidv7(),
    '018f1010-0001-7000-8000-000000000001'::uuid,
    t.id,
    t.default_locale,
    'Mobile Reader Notice',
    'An announcement every reader of the seed tenant can open.'
FROM tenants t
WHERE t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (announcement_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    body = EXCLUDED.body;

DELETE FROM announcement_reads
WHERE announcement_id = '018f1010-0001-7000-8000-000000000001'::uuid;

DELETE FROM notifications n
USING users u
WHERE n.user_id = u.id
  AND u.email = 'member@example.com'
  AND n.notification_type = 'episode_published'
  AND n.subject_key = 'episode:SeedEPSDAAA1';

INSERT INTO notifications (
    id,
    tenant_id,
    user_id,
    notification_type,
    subject_key,
    payload,
    category,
    created_at
)
SELECT
    '018f1010-0001-7000-8000-000000000002'::uuid,
    t.id,
    u.id,
    'episode_published',
    'episode:SeedEPSDAAA1',
    jsonb_build_object(
        'series_id', 'SeedSERSAAA1',
        'series_title', 'Seed Series 001',
        'episode_id', 'SeedEPSDAAA1',
        'episode_title', 'Seed Episode 001-01'
    ),
    'followed_episodes',
    NOW()
FROM tenants t
JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
WHERE t.public_id = 'SeedTNNTAAA1';

WITH target AS (
    SELECT t.id AS tenant_id, s.id AS series_id
    FROM tenants t
    JOIN series s ON s.tenant_id = t.id AND s.public_id = 'SeedSERSAA11'
    WHERE t.public_id = 'SeedTNNTAAA1'
)
INSERT INTO announcements (
    id,
    tenant_id,
    announcement_type,
    audience,
    created_at,
    delivered_at
)
SELECT
    '018f1010-0001-7000-8000-000000000003'::uuid,
    target.tenant_id,
    'system',
    jsonb_build_object(
        'version', 1,
        'conditions', jsonb_build_array(
            jsonb_build_object('type', 'follows_series', 'series_id', target.series_id)
        )
    ),
    NOW(),
    NOW()
FROM target
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    announcement_type = EXCLUDED.announcement_type,
    audience = EXCLUDED.audience,
    created_at = EXCLUDED.created_at,
    delivered_at = EXCLUDED.delivered_at;

INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body)
SELECT
    uuidv7(),
    '018f1010-0001-7000-8000-000000000003'::uuid,
    t.id,
    t.default_locale,
    'Mobile Follower Notice',
    'An announcement for the followers of Seed Series 011 alone.'
FROM tenants t
WHERE t.public_id = 'SeedTNNTAAA1'
ON CONFLICT (announcement_id, locale) DO UPDATE
SET title = EXCLUDED.title,
    body = EXCLUDED.body;

DELETE FROM announcement_reads
WHERE announcement_id = '018f1010-0001-7000-8000-000000000003'::uuid;

DELETE FROM notifications
WHERE notification_type = 'announcement_posted'
  AND subject_key = 'announcement:018f1010-0001-7000-8000-000000000003';

INSERT INTO notifications (
    id,
    tenant_id,
    user_id,
    notification_type,
    subject_key,
    payload,
    category,
    created_at
)
SELECT
    '018f1010-0001-7000-8000-000000000004'::uuid,
    t.id,
    u.id,
    'announcement_posted',
    'announcement:018f1010-0001-7000-8000-000000000003',
    jsonb_build_object('announcement_title', 'Mobile Follower Notice'),
    'announcements',
    NOW()
FROM tenants t
JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
WHERE t.public_id = 'SeedTNNTAAA1';
