-- Scenario: a tenant whose analytics screens report one week exactly
--
-- `admin.analytics.spec.ts` reads Revenue, Audience, and the drop-off of one
-- episode on this tenant's console for the week of 2025-03-03 through
-- 2025-03-09, in shapes an assertion can count exactly. A tenant of its own
-- keeps those figures out of reach of every suite that sells, follows, or
-- reads on the development seed tenant while this one runs.
--
-- Applying it is also how the suite starts over: the tenant is deleted and
-- written again, with everything below.
-- public_id values are hard-coded in e2e/src/scenarios/admin-analytics.ts.
--   tenant   AnlyTNNTAAA1 (analytics.localhost / admin.analytics.localhost),
--            on UTC and selling in the platform's default currency, JPY
--   admin    AnlyADMNAAA1 (analytics-admin@example.com / adminpass)
--   readers  AnlyMMBRAAA1 .. AnlyMMBRAAA4
--   series   AnlySERSAAA1 `Analytics Series 01`, episodes AnlyEPSDAAA1
--            `Analytics Episode 01-01` (300 yen, four pages) and AnlyEPSDAAA2
--            `Analytics Episode 01-02` (500 yen)
--            AnlySERSAAA2 `Analytics Series 02`, episode AnlyEPSDAAA3
--            `Analytics Episode 02-01` (250 yen)
--
-- Revenue, UTC days:
--   2025-03-03  two sales of 01-01                          600 net
--   2025-03-05  one sale of 01-02, refunded in full         0 net
--   2025-03-06  three sales of 02-01                        750 net
--   2025-03-08  one sale of 01-02                           500 net
--   2025-03-10  one sale of 02-01, after the week, not counted
-- That is 7 purchases, 2,350 gross, 500 refunded, and 1,850 net: Series 01
-- 1,100 net over four purchases, Series 02 750 over three.
--
-- Audience: follows of Series 01 by the three readers on 2025-03-02 (before
-- the week), 03-04, and 03-07, and of Series 02 by the first reader on 03-05.
-- Series 02 also gains and loses a follow on 03-04 and 03-06, written straight
-- into series_follow_changes, the way a reader who followed and then took it
-- back leaves it. So 4 followers at the end of the week, 4 follows and 1
-- unfollow during it. The series rows of content_daily_stats add 120 views, 30
-- completions, and 12 reactions to Series 01 on 03-04, and 80, 10, and 4 to
-- Series 02 on 03-06.
--
-- Drop-off of Analytics Episode 01-01: page reach on 03-04 of 10, 9, 5, and 4
-- readers over its four pages, and on 03-06 of 3 and 2 over the first two, so
-- 13, 11, 5, and 4 over the week, and 2, 6, 1, and 4 readers leaving at each
-- page. A day after the week, 2025-03-10, adds 100 to the first page, which is
-- not counted.
--
-- Read-through: one row for Analytics Episode 01-01, two of the tenant's days
-- back from the day the file is applied, so the Episodes screen lists the
-- episode its drop-off is opened from.
--
-- Cohorts: Reader 1 signed up on 2025-02-26, the week before, and Readers 2,
-- 3, and 4 on 03-03, 03-04, and 03-06, so the week of 03-03 is a cohort of
-- three. Their active days, written straight into reader_daily_activity the
-- way the rebuild files them: in week 0 all three (Reader 3 on both series),
-- in week 1 Reader 2 on Series 01, and in week 2 Reader 3 on Series 02. That is
-- 100%, 33%, and 33% of the cohort, or 67%, 33%, and 0% narrowed to Series 01.
-- Each of the three bought: Reader 2 an hour after signing up (sale 1),
-- Reader 3 two days after (sale 4), and Reader 4 fourteen days after, on
-- 03-20, a sale outside the revenue week. So of the three, all were active,
-- two bought within 7 days, all three within 30, and the median wait is 2
-- days.

-- Sales and the catalog restrict the deletes that would reach them from the
-- tenant, so they go first, in the order deleteTenantsByPublicIds uses.
DELETE FROM purchases
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'AnlyTNNTAAA1');

DELETE FROM content_events
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'AnlyTNNTAAA1');

DELETE FROM content_daily_stats
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'AnlyTNNTAAA1');

DELETE FROM series_follows
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'AnlyTNNTAAA1');

DELETE FROM episodes
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'AnlyTNNTAAA1');

DELETE FROM series
WHERE tenant_id IN (SELECT id FROM tenants WHERE public_id = 'AnlyTNNTAAA1');

DELETE FROM tenants
WHERE public_id = 'AnlyTNNTAAA1';

INSERT INTO tenants (
    id,
    public_id,
    domain,
    admin_domain,
    name,
    status,
    timezone,
    default_locale,
    supported_locales
)
VALUES (
    '018f11c0-0001-7000-8000-000000000001'::uuid,
    'AnlyTNNTAAA1',
    'analytics.localhost:' || :'tenant_port',
    'admin.analytics.localhost:' || :'tenant_port',
    'Analytics Tenant',
    'active',
    'UTC',
    'en',
    ARRAY['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant']
);

\set seed_tenant AnlyTNNTAAA1
\ir ../creator_roles.sql

-- The admin and four readers. The password hash is the same as `adminpass`
-- for the admin and `memberpass` for the readers. The readers' sign-ups are
-- the cohorts above; the admin's is left at now, and a member of staff is in
-- no cohort anyway.
INSERT INTO users (
    id,
    tenant_id,
    public_id,
    email,
    password_hash,
    name,
    status,
    email_verified_at,
    created_at
)
SELECT
    u.id,
    t.id,
    u.public_id,
    u.email,
    u.password_hash,
    u.name,
    'active',
    NOW(),
    COALESCE(u.created_at, NOW())
FROM tenants t
CROSS JOIN (
    VALUES
        (
            '018f11c0-0002-7000-8000-000000000001'::uuid,
            'AnlyADMNAAA1',
            'analytics-admin@example.com',
            '$2a$10$IWG04mPtZmFUnCi7UTCT6uMdMwgBorh/EYQDZdmReiMcqdSpcNT9.',
            'Analytics Admin',
            NULL::timestamptz
        ),
        (
            '018f11c0-0002-7000-8000-000000000002'::uuid,
            'AnlyMMBRAAA1',
            'analytics-reader-1@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Analytics Reader 1',
            '2025-02-26T09:00:00Z'::timestamptz
        ),
        (
            '018f11c0-0002-7000-8000-000000000003'::uuid,
            'AnlyMMBRAAA2',
            'analytics-reader-2@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Analytics Reader 2',
            '2025-03-03T08:00:00Z'::timestamptz
        ),
        (
            '018f11c0-0002-7000-8000-000000000004'::uuid,
            'AnlyMMBRAAA3',
            'analytics-reader-3@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Analytics Reader 3',
            '2025-03-04T09:00:00Z'::timestamptz
        ),
        (
            '018f11c0-0002-7000-8000-000000000005'::uuid,
            'AnlyMMBRAAA4',
            'analytics-reader-4@example.com',
            '$2a$10$yVRuW12eeOkFrL7mrE3g4u1vuln1qwz9NVMWzolO13RqeMtwAb7ma',
            'Analytics Reader 4',
            '2025-03-06T09:00:00Z'::timestamptz
        )
) AS u(id, public_id, email, password_hash, name, created_at)
WHERE t.public_id = 'AnlyTNNTAAA1';

INSERT INTO tenant_user_roles (id, user_id, role, tenant_id)
SELECT
    '018f11c0-0003-7000-8000-000000000001'::uuid,
    u.id,
    'tenant_admin',
    u.tenant_id
FROM users u
WHERE u.public_id = 'AnlyADMNAAA1';

INSERT INTO labels (id, tenant_id, public_id, name)
SELECT
    '018f11c0-0004-7000-8000-000000000001'::uuid,
    t.id,
    'AnlyLABLAAA1',
    'Analytics Label 01'
FROM tenants t
WHERE t.public_id = 'AnlyTNNTAAA1';

INSERT INTO series (id, tenant_id, label_id, public_id, is_published, published_at)
SELECT
    s.id,
    t.id,
    '018f11c0-0004-7000-8000-000000000001'::uuid,
    s.public_id,
    true,
    '2025-01-01T00:00:00Z'::timestamptz
FROM tenants t
CROSS JOIN (
    VALUES
        ('018f11c0-0005-7000-8000-000000000001'::uuid, 'AnlySERSAAA1'),
        ('018f11c0-0005-7000-8000-000000000002'::uuid, 'AnlySERSAAA2')
) AS s(id, public_id)
WHERE t.public_id = 'AnlyTNNTAAA1';

INSERT INTO series_translations (id, series_id, tenant_id, locale, title, synopsis)
SELECT
    st.id,
    s.id,
    s.tenant_id,
    'en',
    st.title,
    ''
FROM series s
JOIN (
    VALUES
        ('018f11c0-0006-7000-8000-000000000001'::uuid, 'AnlySERSAAA1', 'Analytics Series 01'),
        ('018f11c0-0006-7000-8000-000000000002'::uuid, 'AnlySERSAAA2', 'Analytics Series 02')
) AS st(id, series_public_id, title) ON st.series_public_id = s.public_id;

INSERT INTO episodes (id, series_id, public_id, order_index, tenant_id)
SELECT
    e.id,
    s.id,
    e.public_id,
    e.order_index,
    s.tenant_id
FROM series s
JOIN (
    VALUES
        ('018f11c0-0007-7000-8000-000000000001'::uuid, 'AnlySERSAAA1', 'AnlyEPSDAAA1', 1),
        ('018f11c0-0007-7000-8000-000000000002'::uuid, 'AnlySERSAAA1', 'AnlyEPSDAAA2', 2),
        ('018f11c0-0007-7000-8000-000000000003'::uuid, 'AnlySERSAAA2', 'AnlyEPSDAAA3', 1)
) AS e(id, series_public_id, public_id, order_index) ON e.series_public_id = s.public_id;

INSERT INTO episode_translations (id, episode_id, tenant_id, locale, title)
SELECT
    et.id,
    e.id,
    e.tenant_id,
    'en',
    et.title
FROM episodes e
JOIN (
    VALUES
        ('018f11c0-0008-7000-8000-000000000001'::uuid, 'AnlyEPSDAAA1', 'Analytics Episode 01-01'),
        ('018f11c0-0008-7000-8000-000000000002'::uuid, 'AnlyEPSDAAA2', 'Analytics Episode 01-02'),
        ('018f11c0-0008-7000-8000-000000000003'::uuid, 'AnlyEPSDAAA3', 'Analytics Episode 02-01')
) AS et(id, episode_public_id, title) ON et.episode_public_id = e.public_id;

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
    el.price,
    72,
    'published',
    NULL::timestamptz,
    '2025-01-01T00:00:00Z'::timestamptz,
    e.tenant_id
FROM episodes e
JOIN (
    VALUES ('AnlyEPSDAAA1', 300), ('AnlyEPSDAAA2', 500), ('AnlyEPSDAAA3', 250)
) AS el(episode_public_id, price) ON el.episode_public_id = e.public_id;

-- The four pages of the episode the drop-off is read on. Only the count is
-- read, so the rows name no stored image.
INSERT INTO episode_images (id, tenant_id, episode_id, display_order)
SELECT
    ('018f11c0-0009-7000-8000-' || lpad(page.n::text, 12, '0'))::uuid,
    e.tenant_id,
    e.id,
    page.n
FROM episodes e
CROSS JOIN generate_series(1, 4) AS page(n)
WHERE e.public_id = 'AnlyEPSDAAA1';

-- The week's sales, one the day after it, and one ten days after that. A
-- revenue report never names the buyer: the three readers' first purchases are
-- what the funnel counts, and every other buyer is left unset the way a
-- deleted reader leaves it.
INSERT INTO purchases (
    id,
    user_id,
    episode_id,
    price_at_purchase,
    currency,
    purchased_at,
    tenant_id,
    refunded_at,
    refunded_amount,
    revoked_at,
    revocation_reason
)
SELECT
    ('018f11c0-000a-7000-8000-' || lpad(sale.n::text, 12, '0'))::uuid,
    u.id,
    e.id,
    el.price,
    'JPY',
    sale.purchased_at,
    e.tenant_id,
    CASE WHEN sale.refunded THEN '2025-03-20T00:00:00Z'::timestamptz END,
    CASE WHEN sale.refunded THEN el.price END,
    CASE WHEN sale.refunded THEN '2025-03-20T00:00:00Z'::timestamptz END,
    CASE WHEN sale.refunded THEN 'refund' END
FROM (
    VALUES
        (1, 'AnlyEPSDAAA1', '2025-03-03T09:00:00Z'::timestamptz, false, 'AnlyMMBRAAA2'),
        (2, 'AnlyEPSDAAA1', '2025-03-03T10:00:00Z'::timestamptz, false, NULL),
        (3, 'AnlyEPSDAAA2', '2025-03-05T09:00:00Z'::timestamptz, true, NULL),
        (4, 'AnlyEPSDAAA3', '2025-03-06T09:00:00Z'::timestamptz, false, 'AnlyMMBRAAA3'),
        (5, 'AnlyEPSDAAA3', '2025-03-06T10:00:00Z'::timestamptz, false, NULL),
        (6, 'AnlyEPSDAAA3', '2025-03-06T11:00:00Z'::timestamptz, false, NULL),
        (7, 'AnlyEPSDAAA2', '2025-03-08T09:00:00Z'::timestamptz, false, NULL),
        (8, 'AnlyEPSDAAA3', '2025-03-10T09:00:00Z'::timestamptz, false, NULL),
        (9, 'AnlyEPSDAAA2', '2025-03-20T09:00:00Z'::timestamptz, false, 'AnlyMMBRAAA4')
) AS sale(n, episode_public_id, purchased_at, refunded, buyer_public_id)
JOIN episodes e ON e.public_id = sale.episode_public_id
JOIN episode_listings el ON el.episode_id = e.id
LEFT JOIN users u ON u.public_id = sale.buyer_public_id;

-- The trigger on series_follows moves the tally and records each change at
-- the follow's created_at, so these follows land on the days named here.
INSERT INTO series_follows (tenant_id, user_id, series_id, created_at)
SELECT
    s.tenant_id,
    u.id,
    s.id,
    follow.created_at
FROM (
    VALUES
        ('AnlyMMBRAAA1', 'AnlySERSAAA1', '2025-03-02T12:00:00Z'::timestamptz),
        ('AnlyMMBRAAA2', 'AnlySERSAAA1', '2025-03-04T12:00:00Z'::timestamptz),
        ('AnlyMMBRAAA3', 'AnlySERSAAA1', '2025-03-07T12:00:00Z'::timestamptz),
        ('AnlyMMBRAAA1', 'AnlySERSAAA2', '2025-03-05T12:00:00Z'::timestamptz)
) AS follow(user_public_id, series_public_id, created_at)
JOIN users u ON u.public_id = follow.user_public_id
JOIN series s ON s.public_id = follow.series_public_id;

-- A follow of Series 02 made and taken back within the week. Deleting a
-- follow records its change at the moment of the delete, so the pair is
-- written as the trigger would have written it then; the tally is left as it
-- is, since the two cancel out.
INSERT INTO series_follow_changes (id, tenant_id, series_id, change, changed_at)
SELECT
    change.id,
    s.tenant_id,
    s.id,
    change.change,
    change.changed_at
FROM (
    VALUES
        ('018f11c0-000b-7000-8000-000000000001'::uuid, 1, '2025-03-04T15:00:00Z'::timestamptz),
        ('018f11c0-000b-7000-8000-000000000002'::uuid, -1, '2025-03-06T15:00:00Z'::timestamptz)
) AS change(id, change, changed_at)
JOIN series s ON s.public_id = 'AnlySERSAAA2';

-- The series rows of the daily statistics the audience report reads, and the
-- read-through row of the episode the Episodes screen lists.
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
    stat.id,
    t.id,
    stat.stat_date,
    stat.entity_type,
    COALESCE(s.id, e.id),
    stat.view_count,
    stat.view_count,
    stat.view_count,
    0,
    stat.complete_count,
    stat.rating_count,
    stat.rating_count * 4,
    0
FROM (
    VALUES
        ('018f11c0-000c-7000-8000-000000000001'::uuid, 'series', 'AnlySERSAAA1', '2025-03-04'::date, 120, 30, 12),
        ('018f11c0-000c-7000-8000-000000000002'::uuid, 'series', 'AnlySERSAAA2', '2025-03-06'::date, 80, 10, 4),
        (
            '018f11c0-000c-7000-8000-000000000003'::uuid,
            'episode',
            'AnlyEPSDAAA1',
            (NOW() AT TIME ZONE 'UTC')::date - 2,
            20,
            8,
            0
        )
) AS stat(id, entity_type, public_id, stat_date, view_count, complete_count, rating_count)
JOIN tenants t ON t.public_id = 'AnlyTNNTAAA1'
LEFT JOIN series s ON stat.entity_type = 'series' AND s.public_id = stat.public_id
LEFT JOIN episodes e ON stat.entity_type = 'episode' AND e.public_id = stat.public_id;

INSERT INTO episode_page_reach_stats (tenant_id, stat_date, episode_id, page_index, reader_count)
SELECT
    e.tenant_id,
    reach.stat_date,
    e.id,
    reach.page_index,
    reach.reader_count
FROM (
    VALUES
        ('2025-03-04'::date, 0, 10),
        ('2025-03-04'::date, 1, 9),
        ('2025-03-04'::date, 2, 5),
        ('2025-03-04'::date, 3, 4),
        ('2025-03-06'::date, 0, 3),
        ('2025-03-06'::date, 1, 2),
        ('2025-03-10'::date, 0, 100)
) AS reach(stat_date, page_index, reader_count)
JOIN episodes e ON e.public_id = 'AnlyEPSDAAA1';

-- The days the cohort was active on, by series.
INSERT INTO reader_daily_activity (tenant_id, stat_date, user_id, series_id)
SELECT
    u.tenant_id,
    activity.stat_date,
    u.id,
    s.id
FROM (
    VALUES
        ('AnlyMMBRAAA2', 'AnlySERSAAA1', '2025-03-04'::date),
        ('AnlyMMBRAAA3', 'AnlySERSAAA1', '2025-03-05'::date),
        ('AnlyMMBRAAA3', 'AnlySERSAAA2', '2025-03-06'::date),
        ('AnlyMMBRAAA4', 'AnlySERSAAA2', '2025-03-06'::date),
        ('AnlyMMBRAAA2', 'AnlySERSAAA1', '2025-03-11'::date),
        ('AnlyMMBRAAA3', 'AnlySERSAAA2', '2025-03-18'::date)
) AS activity(user_public_id, series_public_id, stat_date)
JOIN users u ON u.public_id = activity.user_public_id
JOIN series s ON s.public_id = activity.series_public_id;
