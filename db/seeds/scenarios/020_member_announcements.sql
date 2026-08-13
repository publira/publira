-- Scenario: member announcement list pagination (#717 / #880)
--
-- Gives the dev seed member (`member@example.com` on Host `localhost`) more
-- announcements than one page of the public list holds, so E2E can page across
-- the cursor boundary. The dev seed itself creates no announcements at all.
--
-- 45 rows at `ANNOUNCEMENTS_PAGE_SIZE` 20 means three pages: 20 / 20 / 5.
--
-- Titles are `Notice 001` … `Notice 045` so assertions can match exactly and
-- never collide with the dev seed's `Seed …` records. `created_at` ascends with
-- the number and the ids are UUIDv7-shaped in the same order, which is exactly
-- the `(created_at, id)` keyset the list scans — so `Notice 045` is the newest
-- row and heads the first page.
--
-- ID band: 018f0f10-0001-7000-8000-0000000000NN (NN = the notice number).

WITH target AS (
    SELECT
        t.id AS tenant_id,
        u.id AS user_id
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
    WHERE t.domain = 'localhost'
)
INSERT INTO announcements (
    id,
    tenant_id,
    target_user_id,
    announcement_type,
    title,
    body,
    link_url,
    created_at
)
SELECT
    ('018f0f10-0001-7000-8000-' || lpad(g::text, 12, '0'))::uuid,
    target.tenant_id,
    target.user_id,
    'system',
    'Notice ' || lpad(g::text, 3, '0'),
    'Notice ' || lpad(g::text, 3, '0') || ' の本文です。',
    '/series',
    TIMESTAMPTZ '2026-01-01 00:00:00+00' + (g || ' minutes')::interval
FROM generate_series(1, 45) AS g
CROSS JOIN target
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    target_user_id = EXCLUDED.target_user_id,
    announcement_type = EXCLUDED.announcement_type,
    title = EXCLUDED.title,
    body = EXCLUDED.body,
    link_url = EXCLUDED.link_url,
    created_at = EXCLUDED.created_at;

-- Re-applying the scenario has to restore the unread state too: the list marks
-- rows read as the reader walks it, and a second run would otherwise start from
-- whatever the last run left behind.
DELETE FROM announcement_reads
WHERE announcement_id IN (
    SELECT ('018f0f10-0001-7000-8000-' || lpad(g::text, 12, '0'))::uuid
    FROM generate_series(1, 45) AS g
);
