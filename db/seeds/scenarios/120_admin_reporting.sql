-- Scenario: web-admin reporting screens (audit log and read-through)
--
-- Rows for the two read-only console screens, in shapes an E2E assertion can
-- count exactly (`e2e/tests/admin.reporting.spec.ts`). Constants are in
-- e2e/src/scenarios/admin-reporting.ts.
--
-- Audit log, development seed tenant (`localhost`): 45 entries dated
-- 2026-01-05 .. 2026-01-13, five per calendar day at 03:00 UTC plus one minute
-- per row, so a `from` / `to` filter bounding January 2026 isolates them from
-- the development seed's entries (dated relative to seed time) and from what
-- the parallel specs write while the suite runs. 03:00 UTC is the same calendar
-- day in every tenant time zone, so the filter reads them as the day named
-- here. `target_id` is `rpt-audit-NNN`, and NNN is also the order they list in,
-- newest first.
--   actor    admin@example.com, except every ninth row (n % 9 = 0, five rows),
--            which member@example.com performed and which failed
--   action   cycles series_created, episode_created, label_updated,
--            creator_updated, series_updated (n % 5 = 1, 2, 3, 4, 0), so
--            `label_updated` selects nine rows
--
-- Audit log, Boundary Tenant (`other.localhost`, 010_multi_tenant.sql): a
-- tenant admin, boundary-admin@example.com / adminpass (public_id
-- BndrADMNAAA1), and three entries it made on 2026-01-10 (`rpt-boundary-NNN`).
-- The development seed tenant's console must never list them.
--
-- Read-through, development seed tenant: content_daily_stats rows for the
-- first 25 seed episodes, dated relative to the tenant's own calendar day this
-- file is applied on, because the report's window is the 28 tenant days ending
-- yesterday and the rows have to fall inside it whenever the suite runs. Dates
-- near a window edge are avoided so a local midnight between applying and
-- asserting moves nothing:
--   day -2    every episode: `Seed Episode 001-01` 30 / 60, the next 22 an odd
--             completion count from 45 down to 3 with twice as many member
--             views, `Seed Episode 003-04` 0 / 40, `Seed Episode 003-05` 40 / 40
--   day -15   `Seed Episode 001-01` again, 30 / 60, so its row is a sum
--   day +1    `Seed Episode 001-01` 1000 / 1000 — after the window, not counted
--   day -40   `Seed Episode 001-01` 1000 / 1000 — before the window, not counted
--   day -2    Boundary Tenant's `Boundary Episode 001-01` 777 / 777 — another
--             tenant, not counted
-- Inside the window that is 628 completions over 1256 member views, a 50.0%
-- rate, across 25 episodes: a first page of 20 and a second of 5, with no two
-- episodes sharing a completion count.

-- Audit log: development seed tenant.
WITH tenant_scope AS (
    SELECT t.id AS tenant_id
    FROM tenants t
    WHERE t.domain = 'localhost'
),
admin_user AS (
    SELECT u.id AS user_id
    FROM users u
    WHERE u.email = 'admin@example.com'
),
member_user AS (
    SELECT u.id AS user_id
    FROM users u
    WHERE u.email = 'member@example.com'
),
audit_seed AS (
    SELECT
        gs.n,
        (
            '018f0f50-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS id,
        (gs.n % 9 = 0) AS by_member,
        CASE gs.n % 5
            WHEN 1 THEN 'series_created'
            WHEN 2 THEN 'episode_created'
            WHEN 3 THEN 'label_updated'
            WHEN 4 THEN 'creator_updated'
            ELSE 'series_updated'
        END AS action,
        CASE gs.n % 5
            WHEN 1 THEN 'series'
            WHEN 2 THEN 'episode'
            WHEN 3 THEN 'label'
            WHEN 4 THEN 'creator'
            ELSE 'series'
        END AS target_type,
        (
            TIMESTAMPTZ '2026-01-05 03:00:00+00'
            + make_interval(days => (gs.n - 1) / 5, mins => (gs.n - 1) % 5)
        ) AS created_at
    FROM GENERATE_SERIES(1, 45) AS gs(n)
)
INSERT INTO audit_logs (
    id,
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    outcome,
    client_ip,
    created_at
)
SELECT
    a.id,
    ts.tenant_id,
    CASE WHEN a.by_member THEN mu.user_id ELSE au.user_id END,
    CASE WHEN a.by_member THEN 'member' ELSE 'tenant_admin' END,
    a.action,
    a.target_type,
    FORMAT('rpt-audit-%s', LPAD(a.n::text, 3, '0')),
    CASE WHEN a.by_member THEN 'failure' ELSE 'success' END,
    '192.0.2.10',
    a.created_at
FROM audit_seed a
CROSS JOIN tenant_scope ts
CROSS JOIN admin_user au
CROSS JOIN member_user mu
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    actor_user_id = EXCLUDED.actor_user_id,
    actor_role = EXCLUDED.actor_role,
    action = EXCLUDED.action,
    target_type = EXCLUDED.target_type,
    target_id = EXCLUDED.target_id,
    outcome = EXCLUDED.outcome,
    client_ip = EXCLUDED.client_ip,
    created_at = EXCLUDED.created_at;

-- Boundary Tenant admin. The password hash is the development seed's
-- `adminpass`.
WITH admin_user_seed AS (
    SELECT '018f0f51-0001-7000-8000-000000000001'::uuid AS id
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
    aus.id,
    t.id,
    'BndrADMNAAA1',
    'boundary-admin@example.com',
    '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
    'Boundary Admin',
    'active',
    NOW()
FROM admin_user_seed aus
JOIN tenants t ON t.domain = 'other.localhost'
ON CONFLICT (public_id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    name = EXCLUDED.name,
    status = EXCLUDED.status,
    email_verified_at = EXCLUDED.email_verified_at;

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f0f52-0001-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'BndrADMNAAA1'
ON CONFLICT (user_id, role) DO NOTHING;

-- Audit log: Boundary Tenant.
WITH audit_seed AS (
    SELECT
        gs.n,
        (
            '018f0f53-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS id,
        (
            TIMESTAMPTZ '2026-01-10 03:10:00+00'
            + make_interval(mins => gs.n)
        ) AS created_at
    FROM GENERATE_SERIES(1, 3) AS gs(n)
)
INSERT INTO audit_logs (
    id,
    tenant_id,
    actor_user_id,
    actor_role,
    action,
    target_type,
    target_id,
    outcome,
    client_ip,
    created_at
)
SELECT
    a.id,
    u.tenant_id,
    u.id,
    'tenant_admin',
    'series_created',
    'series',
    FORMAT('rpt-boundary-%s', LPAD(a.n::text, 3, '0')),
    'success',
    '192.0.2.20',
    a.created_at
FROM audit_seed a
CROSS JOIN users u
WHERE u.public_id = 'BndrADMNAAA1'
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    actor_user_id = EXCLUDED.actor_user_id,
    actor_role = EXCLUDED.actor_role,
    action = EXCLUDED.action,
    target_type = EXCLUDED.target_type,
    target_id = EXCLUDED.target_id,
    outcome = EXCLUDED.outcome,
    client_ip = EXCLUDED.client_ip,
    created_at = EXCLUDED.created_at;

-- Read-through. The dates move with the day the file is applied on, taken in
-- each tenant's own time zone because that is the day the aggregate files a
-- row under, and (tenant_id, stat_date, entity_type, entity_id) is unique, so
-- a row re-dated by a later apply could land on the date another of these rows
-- still holds. Removing this scenario's rows first keeps the apply idempotent
-- on any day.
DELETE FROM content_daily_stats
WHERE id >= '018f0f54-0000-7000-8000-000000000000'::uuid
  AND id <= '018f0f54-ffff-7000-8000-ffffffffffff'::uuid;

WITH seed_episode AS (
    -- Seed episode by sequence number (db/seeds/dev/010_catalog.sql).
    SELECT
        gs.n,
        (
            '018f0e73-'
            || LPAD(TO_HEX(gs.n), 4, '0')
            || '-7000-8000-'
            || LPAD(TO_HEX(gs.n), 12, '0')
        )::uuid AS episode_id
    FROM GENERATE_SERIES(1, 25) AS gs(n)
),
in_window AS (
    SELECT
        se.n,
        se.episode_id,
        CASE
            WHEN se.n = 1 THEN 30
            WHEN se.n = 24 THEN 0
            WHEN se.n = 25 THEN 40
            ELSE 2 * (24 - se.n) + 1
        END AS complete_count,
        CASE
            WHEN se.n = 1 THEN 60
            WHEN se.n = 24 THEN 40
            WHEN se.n = 25 THEN 40
            ELSE 2 * (2 * (24 - se.n) + 1)
        END AS member_view_count
    FROM seed_episode se
),
stats_seed (n, tenant_domain, episode_id, day_offset, complete_count, member_view_count) AS (
    SELECT iw.n, 'localhost', iw.episode_id, -2, iw.complete_count, iw.member_view_count
    FROM in_window iw
    UNION ALL
    SELECT 26, 'localhost', se.episode_id, -15, 30, 60
    FROM seed_episode se
    WHERE se.n = 1
    UNION ALL
    SELECT 27, 'localhost', se.episode_id, 1, 1000, 1000
    FROM seed_episode se
    WHERE se.n = 1
    UNION ALL
    SELECT 28, 'localhost', se.episode_id, -40, 1000, 1000
    FROM seed_episode se
    WHERE se.n = 1
    UNION ALL
    SELECT 29, 'other.localhost', e.id, -2, 777, 777
    FROM episodes e
    WHERE e.public_id = 'BndrEPSDAAA1'
)
INSERT INTO content_daily_stats (
    id,
    tenant_id,
    stat_date,
    entity_type,
    entity_id,
    view_count,
    unique_viewer_count,
    member_view_count,
    purchase_count,
    complete_count,
    rating_count,
    rating_sum,
    favorite_count
)
SELECT
    (
        '018f0f54-'
        || LPAD(TO_HEX(ss.n), 4, '0')
        || '-7000-8000-'
        || LPAD(TO_HEX(ss.n), 12, '0')
    )::uuid,
    t.id,
    (NOW() AT TIME ZONE t.timezone)::date + ss.day_offset,
    'episode',
    ss.episode_id,
    ss.member_view_count,
    ss.member_view_count,
    ss.member_view_count,
    0,
    ss.complete_count,
    0,
    0,
    0
FROM stats_seed ss
JOIN tenants t ON t.domain = ss.tenant_domain;
