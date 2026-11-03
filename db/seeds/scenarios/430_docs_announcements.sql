-- Scenario: the announcements the documentation's screenshots show
--
-- The page under docs/<locale>/4-console/ about announcements explains the
-- list and its Notification and Banner columns, and a screenshot of an empty
-- list shows none of them. Three announcements are written into the banner
-- tenant, BnnrTNNTAAA1, which 200_announcement_banner.sql creates and this file
-- needs first; the newest is still shown as the site banner, and the change of
-- terms was sent to everyone. Each was delivered to both of the tenant's
-- accounts, and its member opened two of them, so the Delivered and Opened
-- columns count something.
--
-- Every date is a literal, for the reason 160_screenshot_baseline.sql gives.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts after
-- 200_announcement_banner.sql. The banner suite applies that file again before
-- it runs, which deletes every announcement of the tenant, these included.

BEGIN;

DELETE FROM notifications
WHERE notification_type = 'announcement_posted'
    AND subject_key IN (
        'announcement:018f1090-0003-7000-8000-000000000001',
        'announcement:018f1090-0003-7000-8000-000000000002',
        'announcement:018f1090-0003-7000-8000-000000000003'
    );

DELETE FROM announcements
WHERE id IN (
    '018f1090-0003-7000-8000-000000000001'::uuid,
    '018f1090-0003-7000-8000-000000000002'::uuid,
    '018f1090-0003-7000-8000-000000000003'::uuid
);

-- Each announcement is written in the tenant's default locale, the one a
-- reader in any locale is shown where nothing else was written. The newest is
-- also written in ja, so the list's Languages column names more than one.
WITH a (id, title, body, link_url, created_at, pinned, pinned_until, delivery) AS (
    VALUES
        (
            '018f1090-0003-7000-8000-000000000001'::uuid,
            'Maintenance on Sunday night',
            'The site will be unavailable from 01:00 to 03:00 on Monday morning.',
            NULL,
            '2026-02-04T03:00:00Z'::timestamptz,
            true,
            NULL::timestamptz,
            'preferred'
        ),
        (
            '018f1090-0003-7000-8000-000000000002'::uuid,
            'Our terms of service have changed',
            'We have updated the terms of service. Read the new version before your next purchase.',
            '/legal/terms',
            '2026-01-28T03:00:00Z'::timestamptz,
            false,
            NULL::timestamptz,
            'everyone'
        ),
        (
            '018f1090-0003-7000-8000-000000000003'::uuid,
            'A new series starts this week',
            'Seed Series 101 begins on Friday, with its first three episodes free.',
            '/series',
            '2026-01-20T03:00:00Z'::timestamptz,
            false,
            NULL::timestamptz,
            'preferred'
        )
),
inserted AS (
    INSERT INTO announcements (
        id,
        tenant_id,
        announcement_type,
        link_url,
        created_at,
        deliver_at,
        delivered_at,
        pinned,
        pinned_until,
        delivery
    )
    SELECT
        a.id,
        t.id,
        'announcement',
        a.link_url,
        a.created_at,
        -- Each went out when it was written; the list's Status column shows
        -- the instant, which would otherwise be the moment the file ran.
        a.created_at,
        a.created_at,
        a.pinned,
        a.pinned_until,
        a.delivery
    FROM a
    JOIN tenants t ON t.public_id = 'BnnrTNNTAAA1'
    RETURNING id, tenant_id
)
INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body, created_at, updated_at)
SELECT uuidv7(), a.id, t.id, t.default_locale, a.title, a.body, a.created_at, a.created_at
FROM a
JOIN inserted i ON i.id = a.id
JOIN tenants t ON t.id = i.tenant_id;

-- The list shows the default locale's title, so this copy is never on screen.
INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body, created_at, updated_at)
SELECT
    uuidv7(),
    a.id,
    a.tenant_id,
    'ja',
    'Maintenance on Sunday night, in Japanese',
    'The site will be unavailable from 01:00 to 03:00 on Monday morning, in Japanese.',
    a.created_at,
    a.created_at
FROM announcements a
WHERE a.id = '018f1090-0003-7000-8000-000000000001'::uuid;

-- The rows the worker's fan-out writes when each goes out: one per account of
-- the tenant, filed under the category its delivery answers to.
INSERT INTO notifications (id, tenant_id, user_id, notification_type, subject_key, payload, category, created_at)
SELECT
    uuidv7(),
    a.tenant_id,
    u.id,
    'announcement_posted',
    'announcement:' || a.id::text,
    jsonb_build_object('announcement_title', tr.title),
    CASE a.delivery WHEN 'everyone' THEN 'everyone' ELSE 'announcements' END,
    a.delivered_at
FROM announcements a
JOIN announcement_translations tr ON tr.announcement_id = a.id AND tr.locale = 'en'
JOIN users u ON u.tenant_id = a.tenant_id
WHERE a.id IN (
    '018f1090-0003-7000-8000-000000000001'::uuid,
    '018f1090-0003-7000-8000-000000000002'::uuid,
    '018f1090-0003-7000-8000-000000000003'::uuid
);

INSERT INTO announcement_reads (announcement_id, tenant_id, user_id, read_at)
SELECT a.id, a.tenant_id, u.id, a.delivered_at + interval '1 hour'
FROM announcements a
JOIN users u ON u.tenant_id = a.tenant_id AND u.public_id = 'BnnrMMBRAAA1'
WHERE a.id IN (
    '018f1090-0003-7000-8000-000000000001'::uuid,
    '018f1090-0003-7000-8000-000000000002'::uuid
);

COMMIT;
