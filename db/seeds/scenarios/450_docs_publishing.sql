-- Scenario: the episodes waiting to be published that the documentation's
-- screenshots show
--
-- The pages under docs/<locale>/4-console/ explain an episode's three states
-- on the series' episode list and the Dashboard's publishing queue, and the
-- development seed publishes every episode it writes. Two episodes are added
-- to the series of the moderation tenant, ModrTNNTAAA1, which
-- 150_comment_moderation.sql creates and this file needs first: one scheduled
-- and one draft. The scheduled one is due years ahead, as a literal, so the
-- worker never publishes it and the screens print the same time on every run.
--
-- Applied by e2e/tests/admin.docs-screenshots.setup.ts. Neither episode is
-- shown on the tenant's site, and the moderation suite reads its first
-- episode alone, so the file deletes and writes only its own rows.

BEGIN;

DELETE FROM episodes
WHERE id IN (
    '018f1090-0005-7000-8000-000000000001'::uuid,
    '018f1090-0005-7000-8000-000000000002'::uuid
);

INSERT INTO episodes (id, series_id, public_id, title, order_index, tenant_id, created_at)
SELECT
    e.id,
    s.id,
    e.public_id,
    e.title,
    e.order_index,
    s.tenant_id,
    e.created_at
FROM (
    VALUES
        (
            '018f1090-0005-7000-8000-000000000001'::uuid,
            'DocsEPSDAAA1',
            'Moderation Episode 001-02',
            2,
            '2026-02-05T09:00:00Z'::timestamptz
        ),
        (
            '018f1090-0005-7000-8000-000000000002'::uuid,
            'DocsEPSDAAA2',
            'Moderation Episode 001-03',
            3,
            '2026-02-06T09:00:00Z'::timestamptz
        )
) AS e (id, public_id, title, order_index, created_at)
JOIN series s ON s.id = '018f0f73-0001-7000-8000-000000000001'::uuid;

INSERT INTO episode_listings (
    episode_id,
    price,
    reading_period_hours,
    status,
    scheduled_at,
    published_at,
    tenant_id
)
SELECT
    e.id,
    l.price,
    72,
    l.status,
    l.scheduled_at,
    NULL,
    e.tenant_id
FROM (
    VALUES
        (
            '018f1090-0005-7000-8000-000000000001'::uuid,
            120,
            'scheduled',
            '2030-01-11T03:00:00Z'::timestamptz
        ),
        (
            '018f1090-0005-7000-8000-000000000002'::uuid,
            120,
            'draft',
            NULL::timestamptz
        )
) AS l (episode_id, price, status, scheduled_at)
JOIN episodes e ON e.id = l.episode_id;

COMMIT;
