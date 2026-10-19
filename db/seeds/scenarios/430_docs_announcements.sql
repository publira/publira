-- Scenario: the announcements the documentation's screenshots show
--
-- The page under docs/<locale>/4-console/ about announcements explains the
-- list and its Banner column, and a screenshot of an empty list shows
-- neither. Three announcements are written into the banner tenant,
-- BnnrTNNTAAA1, which 200_announcement_banner.sql creates and this file needs
-- first; the newest is still shown as the site banner.
--
-- Every date is a literal, for the reason 160_screenshot_baseline.sql gives.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts after
-- 200_announcement_banner.sql. The banner suite applies that file again before
-- it runs, which deletes every announcement of the tenant, these included.

BEGIN;

DELETE FROM announcements
WHERE id IN (
    '018f1090-0003-7000-8000-000000000001'::uuid,
    '018f1090-0003-7000-8000-000000000002'::uuid,
    '018f1090-0003-7000-8000-000000000003'::uuid
);

-- Each announcement is written in the tenant's default locale, the one a
-- reader in any locale is shown where nothing else was written.
WITH a (id, title, body, link_url, created_at, pinned, pinned_until) AS (
    VALUES
        (
            '018f1090-0003-7000-8000-000000000001'::uuid,
            'Maintenance on Sunday night',
            'The site will be unavailable from 01:00 to 03:00 on Monday morning.',
            NULL,
            '2026-02-04T03:00:00Z'::timestamptz,
            true,
            NULL::timestamptz
        ),
        (
            '018f1090-0003-7000-8000-000000000002'::uuid,
            'Our terms of service have changed',
            'We have updated the terms of service. Read the new version before your next purchase.',
            '/legal/terms',
            '2026-01-28T03:00:00Z'::timestamptz,
            false,
            NULL::timestamptz
        ),
        (
            '018f1090-0003-7000-8000-000000000003'::uuid,
            'A new series starts this week',
            'Seed Series 101 begins on Friday, with its first three episodes free.',
            '/series',
            '2026-01-20T03:00:00Z'::timestamptz,
            false,
            NULL::timestamptz
        )
),
inserted AS (
    INSERT INTO announcements (
        id,
        tenant_id,
        announcement_type,
        link_url,
        created_at,
        pinned,
        pinned_until
    )
    SELECT
        a.id,
        t.id,
        'announcement',
        a.link_url,
        a.created_at,
        a.pinned,
        a.pinned_until
    FROM a
    JOIN tenants t ON t.public_id = 'BnnrTNNTAAA1'
    RETURNING id, tenant_id
)
INSERT INTO announcement_translations (id, announcement_id, tenant_id, locale, title, body, created_at, updated_at)
SELECT uuidv7(), a.id, t.id, t.default_locale, a.title, a.body, a.created_at, a.created_at
FROM a
JOIN inserted i ON i.id = a.id
JOIN tenants t ON t.id = i.tenant_id;

COMMIT;
