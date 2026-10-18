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
-- episode alone, so the file deletes and writes only its own rows. The
-- documentation's shot of an episode's Cover image tab uploads a cover to the
-- draft, and deleting the episode here drops that cover with it, so every run
-- starts from a draft without one.
--
-- The series' Volumes tab is photographed too, so the file gives the series
-- two volumes: one on sale holding both episodes above, and an empty one never
-- on sale. An episode a volume holds cannot be deleted, so the volumes go
-- first and are written again after the episodes.

BEGIN;

DELETE FROM volumes
WHERE id IN (
    '018f1090-0005-7000-8000-000000000005'::uuid,
    '018f1090-0005-7000-8000-000000000006'::uuid
);

DELETE FROM episodes
WHERE id IN (
    '018f1090-0005-7000-8000-000000000001'::uuid,
    '018f1090-0005-7000-8000-000000000002'::uuid
);

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id, created_at)
SELECT
    e.id,
    s.id,
    e.public_id,
    e.order_index,
    s.tenant_id,
    e.created_at
FROM (
    VALUES
        (
            '018f1090-0005-7000-8000-000000000001'::uuid,
            'DocsEPSDAAA1',
            2,
            '2026-02-05T09:00:00Z'::timestamptz
        ),
        (
            '018f1090-0005-7000-8000-000000000002'::uuid,
            'DocsEPSDAAA2',
            3,
            '2026-02-06T09:00:00Z'::timestamptz
        )
) AS e (id, public_id, order_index, created_at)
JOIN series s ON s.id = '018f0f73-0001-7000-8000-000000000001'::uuid;

-- Each title, as the episode's translation in the tenant's default locale,
-- dated with the episode so the screens print no time of the run.
INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title, created_at, updated_at)
SELECT
    tr.id,
    e.id,
    e.tenant_id,
    t.default_locale,
    tr.title,
    e.created_at,
    e.created_at
FROM (
    VALUES
        (
            '018f1090-0005-7000-8000-000000000003'::uuid,
            '018f1090-0005-7000-8000-000000000001'::uuid,
            'Moderation Episode 001-02'
        ),
        (
            '018f1090-0005-7000-8000-000000000004'::uuid,
            '018f1090-0005-7000-8000-000000000002'::uuid,
            'Moderation Episode 001-03'
        )
) AS tr (id, episode_id, title)
JOIN episodes e ON e.id = tr.episode_id
JOIN tenants t ON t.id = e.tenant_id
ON CONFLICT (episode_id, locale) DO UPDATE
SET title = EXCLUDED.title;

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

INSERT INTO volumes (
    id,
    tenant_id,
    public_id,
    series_id,
    title,
    order_index,
    price,
    is_published,
    published_at,
    created_at,
    updated_at
)
SELECT
    v.id,
    s.tenant_id,
    v.public_id,
    s.id,
    v.title,
    v.order_index,
    v.price,
    v.published_at IS NOT NULL,
    v.published_at,
    v.created_at,
    v.created_at
FROM (
    VALUES
        (
            '018f1090-0005-7000-8000-000000000005'::uuid,
            'DocsVOLMAAA1',
            'Moderation Volume 1',
            0,
            300,
            '2026-02-07T09:00:00Z'::timestamptz,
            '2026-02-07T09:00:00Z'::timestamptz
        ),
        (
            '018f1090-0005-7000-8000-000000000006'::uuid,
            'DocsVOLMAAA2',
            'Moderation Volume 2',
            1,
            500,
            NULL::timestamptz,
            '2026-02-08T09:00:00Z'::timestamptz
        )
) AS v (id, public_id, title, order_index, price, published_at, created_at)
JOIN series s ON s.id = '018f0f73-0001-7000-8000-000000000001'::uuid;

INSERT INTO volume_episodes (tenant_id, volume_id, episode_id, position)
SELECT
    e.tenant_id,
    '018f1090-0005-7000-8000-000000000005'::uuid,
    e.id,
    ve.position
FROM (
    VALUES
        ('018f1090-0005-7000-8000-000000000001'::uuid, 0),
        ('018f1090-0005-7000-8000-000000000002'::uuid, 1)
) AS ve (episode_id, position)
JOIN episodes e ON e.id = ve.episode_id;

COMMIT;
