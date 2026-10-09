-- Scenario: the comments the documentation's screenshots show
--
-- The page under docs/<locale>/4-console/ about readers explains the console's
-- comment queues, and a screenshot of them is only worth showing with rows in
-- it. They are written onto the episode of the moderation tenant,
-- ModrTNNTAAA1, which 150_comment_moderation.sql creates and this file needs
-- first: four comments, one in each state the moderation screen tells apart,
-- one of them reported.
--
-- Every date is a literal, for the reason 160_screenshot_baseline.sql gives:
-- the screen prints them, and an image compared pixel by pixel cannot absorb
-- a date that moves with the day the stack was seeded. No comment is
-- withdrawn by its commenter, since the list counts the days until such a
-- comment is purged from today.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts after
-- 150_comment_moderation.sql. The moderation suite applies that file again
-- before it runs, which deletes every comment on the episode, these included.

BEGIN;

DELETE FROM episode_comments
WHERE id IN (
    '018f1090-0001-7000-8000-000000000001'::uuid,
    '018f1090-0001-7000-8000-000000000002'::uuid,
    '018f1090-0001-7000-8000-000000000003'::uuid,
    '018f1090-0001-7000-8000-000000000004'::uuid
);

WITH comment_seed (
    id,
    public_id,
    author_public_id,
    body,
    status,
    created_at,
    published_at,
    hidden_at,
    hidden_reason,
    hidden_by_public_id,
    open_report_count
) AS (
    VALUES
        (
            '018f1090-0001-7000-8000-000000000001'::uuid,
            'DocsCMNTAAA1',
            'ModrMMBRAAA1',
            'The last page made me laugh out loud. Waiting for the next one!',
            'pending',
            '2026-02-03T09:15:00Z'::timestamptz,
            NULL::timestamptz,
            NULL::timestamptz,
            NULL,
            NULL,
            0
        ),
        (
            '018f1090-0001-7000-8000-000000000002'::uuid,
            'DocsCMNTAAA2',
            'ModrMMBRAAA1',
            'The ending of this episode spoils the whole series.',
            'published',
            '2026-02-02T18:40:00Z'::timestamptz,
            '2026-02-02T19:00:00Z'::timestamptz,
            NULL::timestamptz,
            NULL,
            NULL,
            1
        ),
        (
            '018f1090-0001-7000-8000-000000000003'::uuid,
            'DocsCMNTAAA3',
            'ModrMMBRAAA2',
            'Buy cheap followers at example.net.',
            'hidden',
            '2026-02-01T07:05:00Z'::timestamptz,
            '2026-02-01T07:05:00Z'::timestamptz,
            '2026-02-01T08:30:00Z'::timestamptz,
            'staff',
            'ModrADMNAAA1',
            0
        ),
        (
            '018f1090-0001-7000-8000-000000000004'::uuid,
            'DocsCMNTAAA4',
            'ModrMMBRAAA2',
            'Lovely colours on the cover.',
            'published',
            '2026-01-31T12:00:00Z'::timestamptz,
            '2026-01-31T12:20:00Z'::timestamptz,
            NULL::timestamptz,
            NULL,
            NULL,
            0
        )
)
INSERT INTO episode_comments (
    id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    body,
    status,
    approved_by,
    hidden_by,
    hidden_reason,
    created_at,
    updated_at,
    published_at,
    hidden_at,
    open_report_count
)
SELECT
    cs.id,
    t.id,
    cs.public_id,
    e.id,
    author.id,
    cs.body,
    cs.status,
    NULL,
    hider.id,
    cs.hidden_reason,
    cs.created_at,
    COALESCE(cs.hidden_at, cs.published_at, cs.created_at),
    cs.published_at,
    cs.hidden_at,
    cs.open_report_count
FROM comment_seed cs
JOIN tenants t ON t.public_id = 'ModrTNNTAAA1'
JOIN episodes e ON e.tenant_id = t.id AND e.public_id = 'ModrEPSDAAA1'
JOIN users author ON author.public_id = cs.author_public_id
LEFT JOIN users hider ON hider.public_id = cs.hidden_by_public_id;

INSERT INTO episode_comment_reports (
    id,
    tenant_id,
    comment_id,
    reporter_user_id,
    reason,
    note,
    status,
    created_at
)
SELECT
    '018f1090-0002-7000-8000-000000000001'::uuid,
    c.tenant_id,
    c.id,
    reporter.id,
    'spoiler',
    'It gives away who the culprit is.',
    'open',
    '2026-02-02T21:10:00Z'::timestamptz
FROM episode_comments c
JOIN users reporter ON reporter.public_id = 'ModrMMBRAAA2'
WHERE c.id = '018f1090-0001-7000-8000-000000000002'::uuid;

COMMIT;
