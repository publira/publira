-- The console's reader cohorts: of the readers who signed up over a period of
-- the tenant's days, how many kept reading and how many bought.
--
-- A reader is an account of the tenant that holds no staff role, counted from
-- users.created_at in time_zone, which is kept for good. The days a reader was
-- active come from reader_daily_activity, which aggregate-content-stats files
-- from the content events of each tenant day before they are purged, so a day
-- reaches these figures once it has been rebuilt. A deleted account takes its
-- user row and its active days with it, and leaves every figure at once.

-- name: ListRetentionCohorts :many
-- Every calendar week, Monday through Sunday, from the one start_date falls in
-- through the one end_date falls in, a week nobody signed up in included, each
-- counted whole. A cohort is the readers who signed up in one of them, and
-- week_index k is the k-th week after that one, 0 being the sign-up week.
--
-- Each cohort carries a row for every week from 0 through 12 that has ended by
-- today in time_zone, and for a cohort none of whose weeks has ended, one row
-- whose week_index is -1, so the cohort is still answered with its size. A
-- week still in progress is left out rather than counted short. series_id
-- narrows the active days to one series, and NULL leaves the whole tenant;
-- it never narrows the cohort itself.
--
-- The weeks are generated as timestamps without a zone, so the session's own
-- zone cannot move one onto the week before.
WITH weeks AS (
    SELECT w.week::date AS week_start
    FROM generate_series(
        date_trunc('week', sqlc.arg('start_date')::date::timestamp),
        date_trunc('week', sqlc.arg('end_date')::date::timestamp),
        interval '1 week'
    ) AS w(week)
), cohort AS (
    SELECT
        u.id AS user_id,
        date_trunc('week', u.created_at AT TIME ZONE sqlc.arg('time_zone')::text)::date AS week_start
    FROM users u
    WHERE u.tenant_id = sqlc.arg('tenant_id')::uuid
        AND u.created_at >= ((SELECT min(week_start) FROM weeks)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND u.created_at < (((SELECT max(week_start) FROM weeks) + 7)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND NOT EXISTS (
            SELECT 1
            FROM tenant_user_roles tur
            WHERE tur.user_id = u.id
        )
), sizes AS (
    SELECT c.week_start, count(*)::bigint AS cohort_size
    FROM cohort c
    GROUP BY c.week_start
), active AS (
    SELECT
        c.week_start,
        ((rda.stat_date - c.week_start) / 7)::integer AS week_index,
        count(DISTINCT rda.user_id)::bigint AS active_count
    FROM cohort c
    JOIN reader_daily_activity rda ON rda.tenant_id = sqlc.arg('tenant_id')
        AND rda.user_id = c.user_id
        AND rda.stat_date >= c.week_start
        AND rda.stat_date < c.week_start + 13 * 7
    WHERE sqlc.narg('series_id')::uuid IS NULL OR rda.series_id = sqlc.narg('series_id')::uuid
    GROUP BY 1, 2
)
SELECT
    w.week_start,
    COALESCE(s.cohort_size, 0)::bigint AS cohort_size,
    COALESCE(k.week_index, -1)::integer AS week_index,
    COALESCE(a.active_count, 0)::bigint AS active_count
FROM weeks w
LEFT JOIN sizes s ON s.week_start = w.week_start
LEFT JOIN LATERAL generate_series(
    0,
    LEAST(12, ((now() AT TIME ZONE sqlc.arg('time_zone')::text)::date - w.week_start) / 7 - 1)
) AS k(week_index) ON TRUE
LEFT JOIN active a ON a.week_start = w.week_start AND a.week_index = k.week_index
ORDER BY w.week_start, k.week_index;

-- name: GetSignUpFunnel :one
-- The readers who signed up from the tenant's midnight of start_date to its
-- midnight after end_date, how many of them were ever active, and how soon
-- they first bought. A purchase of any kind counts, refunded or not, except
-- one made in a store's sandbox or a payment provider's test mode, which is
-- left out as the revenue report leaves it out. The days to the first purchase
-- are elapsed time, 24 hours a day, from the moment the account was created.
WITH cohort AS (
    SELECT u.id, u.created_at
    FROM users u
    WHERE u.tenant_id = sqlc.arg('tenant_id')
        AND u.created_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND u.created_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND NOT EXISTS (
            SELECT 1
            FROM tenant_user_roles tur
            WHERE tur.user_id = u.id
        )
), first_purchases AS (
    SELECT c.id, min(p.purchased_at) - c.created_at AS wait
    FROM cohort c
    JOIN purchases p ON p.tenant_id = sqlc.arg('tenant_id')
        AND p.user_id = c.id
        AND NOT p.is_test
    GROUP BY c.id, c.created_at
)
SELECT
    (SELECT count(*) FROM cohort)::bigint AS signed_up_count,
    (
        SELECT count(*)
        FROM cohort c
        WHERE EXISTS (
            SELECT 1
            FROM reader_daily_activity rda
            WHERE rda.tenant_id = sqlc.arg('tenant_id')
                AND rda.user_id = c.id
        )
    )::bigint AS active_count,
    count(*) FILTER (WHERE fp.wait < interval '7 days')::bigint AS purchased_within_seven_days_count,
    count(*) FILTER (WHERE fp.wait < interval '30 days')::bigint AS purchased_within_thirty_days_count,
    count(*)::bigint AS purchased_count,
    COALESCE(
        percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM fp.wait) / 86400),
        0
    )::double precision AS median_days_to_first_purchase
FROM first_purchases fp;
