-- Scenario: an unread announcement and an unread notification for the seed
-- member, read by the mobile app over the live API
--
-- The development seed posts no announcement and delivers the member no
-- notification, so a live test of the app's inbox and announcement list could
-- only prove that the reads were answered. With one of each, the app's live
-- group opens them and asks the API whether the read mark it sent landed: the
-- same record the storefront reads back for the same account.
--
-- Applied by `mobile/scripts/e2e-db-setup.sh` rather than for the whole E2E
-- stack: the Playwright suites read the seed tenant's announcements and the
-- member's bell, and a row they do not expect would move what they assert.
--
-- Re-applying it puts both rows back to unread. The notification is deleted
-- and written again, because its natural key (member, type, subject) is what a
-- published episode would also write.
--
-- ID band: 018f1010-0001-7000-8000-0000000000NN. The two ids are constants in
-- mobile/test/support/connect_fixture_server.dart.

WITH target AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.domain = 'localhost'
)
INSERT INTO announcements (
    id,
    tenant_id,
    announcement_type,
    title,
    body,
    created_at
)
SELECT
    '018f1010-0001-7000-8000-000000000001'::uuid,
    target.tenant_id,
    'system',
    'Mobile Reader Notice',
    'An announcement every reader of the seed tenant can open.',
    NOW()
FROM target
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    announcement_type = EXCLUDED.announcement_type,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    created_at = EXCLUDED.created_at;

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
    NOW()
FROM tenants t
JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
WHERE t.domain = 'localhost';
