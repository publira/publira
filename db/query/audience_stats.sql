-- The console's audience statistics: how a tenant's series were followed,
-- read, and reacted to over a period of its own days.
--
-- The period runs from the tenant's midnight of start_date to its midnight
-- after end_date in time_zone. series_id narrows every query to one series, and
-- NULL leaves the whole tenant.
--
-- Followers come from series_follower_counts and series_follow_changes, which
-- the triggers on series_follows keep, so a follow made a moment ago is in
-- them. The number of followers at the end of a day is the tally less every
-- change after that day, which is why each query reads the changes from the
-- start of the period to now rather than to its end.
--
-- Views, completed reads, and reactions are the series rows of
-- content_daily_stats, which already roll up every episode of the series and
-- reach a day once aggregate-content-stats has rebuilt it. A reaction is one
-- press that added points to a reader's score of an episode, which is
-- rating_count there, and the points it added are rating_sum.

-- name: GetAudienceTotals :one
WITH followers AS (
    SELECT COALESCE(sum(sfc.count), 0)::bigint AS count
    FROM series_follower_counts sfc
    WHERE sfc.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR sfc.series_id = sqlc.narg('series_id')::uuid)
), changes AS (
    SELECT
        COALESCE(sum(c.change) FILTER (
            WHERE c.changed_at >= ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        ), 0)::bigint AS after_period,
        count(*) FILTER (
            WHERE c.change > 0
                AND c.changed_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        )::bigint AS followed_count,
        count(*) FILTER (
            WHERE c.change < 0
                AND c.changed_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        )::bigint AS unfollowed_count
    FROM series_follow_changes c
    WHERE c.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR c.series_id = sqlc.narg('series_id')::uuid)
        AND c.changed_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
), stats AS (
    SELECT
        COALESCE(sum(cds.view_count), 0)::bigint AS view_count,
        COALESCE(sum(cds.complete_count), 0)::bigint AS complete_count,
        COALESCE(sum(cds.rating_count), 0)::bigint AS reaction_count,
        COALESCE(sum(cds.rating_sum), 0)::bigint AS reaction_points
    FROM content_daily_stats cds
    WHERE cds.tenant_id = sqlc.arg('tenant_id')
        AND cds.entity_type = 'series'
        AND (sqlc.narg('series_id')::uuid IS NULL OR cds.entity_id = sqlc.narg('series_id')::uuid)
        AND cds.stat_date BETWEEN sqlc.arg('start_date')::date AND sqlc.arg('end_date')::date
)
SELECT
    (f.count - ch.after_period)::bigint AS follower_count,
    ch.followed_count,
    ch.unfollowed_count,
    st.view_count,
    st.complete_count,
    st.reaction_count,
    st.reaction_points
FROM followers f, changes ch, stats st;

-- name: ListAudienceByDay :many
-- Every day of the period in order, a quiet day included, so a chart of it has
-- no gap to fill. The days are generated as timestamps without a zone, so the
-- session's own zone cannot move one onto the day before.
WITH followers AS (
    SELECT COALESCE(sum(sfc.count), 0)::bigint AS count
    FROM series_follower_counts sfc
    WHERE sfc.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR sfc.series_id = sqlc.narg('series_id')::uuid)
), after_period AS (
    SELECT COALESCE(sum(c.change), 0)::bigint AS change
    FROM series_follow_changes c
    WHERE c.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR c.series_id = sqlc.narg('series_id')::uuid)
        AND c.changed_at >= ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
), day_changes AS (
    SELECT
        (c.changed_at AT TIME ZONE sqlc.arg('time_zone')::text)::date AS day,
        count(*) FILTER (WHERE c.change > 0)::bigint AS followed_count,
        count(*) FILTER (WHERE c.change < 0)::bigint AS unfollowed_count
    FROM series_follow_changes c
    WHERE c.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR c.series_id = sqlc.narg('series_id')::uuid)
        AND c.changed_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        AND c.changed_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    GROUP BY 1
), day_stats AS (
    SELECT
        cds.stat_date AS day,
        sum(cds.view_count)::bigint AS view_count,
        sum(cds.complete_count)::bigint AS complete_count,
        sum(cds.rating_count)::bigint AS reaction_count,
        sum(cds.rating_sum)::bigint AS reaction_points
    FROM content_daily_stats cds
    WHERE cds.tenant_id = sqlc.arg('tenant_id')
        AND cds.entity_type = 'series'
        AND (sqlc.narg('series_id')::uuid IS NULL OR cds.entity_id = sqlc.narg('series_id')::uuid)
        AND cds.stat_date BETWEEN sqlc.arg('start_date')::date AND sqlc.arg('end_date')::date
    GROUP BY cds.stat_date
), days AS (
    SELECT
        d.day::date AS day,
        COALESCE(dc.followed_count, 0)::bigint AS followed_count,
        COALESCE(dc.unfollowed_count, 0)::bigint AS unfollowed_count,
        COALESCE(ds.view_count, 0)::bigint AS view_count,
        COALESCE(ds.complete_count, 0)::bigint AS complete_count,
        COALESCE(ds.reaction_count, 0)::bigint AS reaction_count,
        COALESCE(ds.reaction_points, 0)::bigint AS reaction_points
    FROM generate_series(
        sqlc.arg('start_date')::date::timestamp,
        sqlc.arg('end_date')::date::timestamp,
        interval '1 day'
    ) AS d(day)
    LEFT JOIN day_changes dc ON dc.day = d.day::date
    LEFT JOIN day_stats ds ON ds.day = d.day::date
)
SELECT
    days.day AS stat_date,
    (
        f.count
        - ap.change
        - COALESCE(sum(days.followed_count - days.unfollowed_count) OVER (
            ORDER BY days.day DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0)
    )::bigint AS follower_count,
    days.followed_count,
    days.unfollowed_count,
    days.view_count,
    days.complete_count,
    days.reaction_count,
    days.reaction_points
FROM days, followers f, after_period ap
ORDER BY days.day;

-- name: ListSeriesAudienceDesc :many
-- Every series of the tenant, the most followed at the end of the period first.
-- A series nobody follows and nobody read is a row too, at the bottom, so the
-- report is the catalogue rather than the part of it that moved.
--
-- The rating is the series' figure now, the one its page shows, rather than one
-- of the period: it is formed over every reaction the series ever collected,
-- and is read only for the rows of the page, after the limit, because each one
-- reads the series' whole history in content_daily_stats.
WITH changes AS (
    SELECT
        c.series_id,
        COALESCE(sum(c.change) FILTER (
            WHERE c.changed_at >= ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        ), 0)::bigint AS after_period,
        count(*) FILTER (
            WHERE c.change > 0
                AND c.changed_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        )::bigint AS followed_count,
        count(*) FILTER (
            WHERE c.change < 0
                AND c.changed_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        )::bigint AS unfollowed_count
    FROM series_follow_changes c
    WHERE c.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR c.series_id = sqlc.narg('series_id')::uuid)
        AND c.changed_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    GROUP BY c.series_id
), stats AS (
    SELECT
        cds.entity_id AS series_id,
        sum(cds.view_count)::bigint AS view_count,
        sum(cds.complete_count)::bigint AS complete_count,
        sum(cds.rating_count)::bigint AS reaction_count,
        sum(cds.rating_sum)::bigint AS reaction_points
    FROM content_daily_stats cds
    WHERE cds.tenant_id = sqlc.arg('tenant_id')
        AND cds.entity_type = 'series'
        AND (sqlc.narg('series_id')::uuid IS NULL OR cds.entity_id = sqlc.narg('series_id')::uuid)
        AND cds.stat_date BETWEEN sqlc.arg('start_date')::date AND sqlc.arg('end_date')::date
    GROUP BY cds.entity_id
), audience AS (
    SELECT
        s.id AS series_id,
        s.public_id AS series_public_id,
        (COALESCE(sfc.count, 0) - COALESCE(ch.after_period, 0))::bigint AS follower_count,
        COALESCE(ch.followed_count, 0)::bigint AS followed_count,
        COALESCE(ch.unfollowed_count, 0)::bigint AS unfollowed_count,
        COALESCE(st.view_count, 0)::bigint AS view_count,
        COALESCE(st.complete_count, 0)::bigint AS complete_count,
        COALESCE(st.reaction_count, 0)::bigint AS reaction_count,
        COALESCE(st.reaction_points, 0)::bigint AS reaction_points
    FROM series s
    LEFT JOIN series_follower_counts sfc ON sfc.tenant_id = s.tenant_id AND sfc.series_id = s.id
    LEFT JOIN changes ch ON ch.series_id = s.id
    LEFT JOIN stats st ON st.series_id = s.id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR s.id = sqlc.narg('series_id')::uuid)
), page AS (
    SELECT *
    FROM audience a
    WHERE (
            sqlc.narg('cursor_series_id')::uuid IS NULL
            OR (
                sqlc.arg('cursor_inclusive')::boolean
                AND (a.follower_count, a.series_id) <= (
                    sqlc.narg('cursor_follower_count')::bigint,
                    sqlc.narg('cursor_series_id')::uuid
                )
            )
            OR (
                NOT sqlc.arg('cursor_inclusive')::boolean
                AND (a.follower_count, a.series_id) < (
                    sqlc.narg('cursor_follower_count')::bigint,
                    sqlc.narg('cursor_series_id')::uuid
                )
            )
        )
    ORDER BY a.follower_count DESC, a.series_id DESC
    LIMIT sqlc.arg('limit')
)
SELECT
    p.series_id,
    p.series_public_id,
    str.title AS series_title,
    p.follower_count,
    p.followed_count,
    p.unfollowed_count,
    p.view_count,
    p.complete_count,
    p.reaction_count,
    p.reaction_points,
    r.rating_count::bigint AS rating_count,
    r.rating_average::double precision AS rating_average
FROM page p
CROSS JOIN LATERAL series_translation_for(p.series_id, '') str
CROSS JOIN LATERAL series_rating(sqlc.arg('tenant_id')::uuid, p.series_id) r
ORDER BY p.follower_count DESC, p.series_id DESC;

-- name: ListSeriesAudienceAsc :many
-- ListSeriesAudienceDesc walked the other way, to build a previous page. The
-- order it describes is the same one.
WITH changes AS (
    SELECT
        c.series_id,
        COALESCE(sum(c.change) FILTER (
            WHERE c.changed_at >= ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        ), 0)::bigint AS after_period,
        count(*) FILTER (
            WHERE c.change > 0
                AND c.changed_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        )::bigint AS followed_count,
        count(*) FILTER (
            WHERE c.change < 0
                AND c.changed_at < ((sqlc.arg('end_date')::date + 1)::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
        )::bigint AS unfollowed_count
    FROM series_follow_changes c
    WHERE c.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR c.series_id = sqlc.narg('series_id')::uuid)
        AND c.changed_at >= (sqlc.arg('start_date')::date::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
    GROUP BY c.series_id
), stats AS (
    SELECT
        cds.entity_id AS series_id,
        sum(cds.view_count)::bigint AS view_count,
        sum(cds.complete_count)::bigint AS complete_count,
        sum(cds.rating_count)::bigint AS reaction_count,
        sum(cds.rating_sum)::bigint AS reaction_points
    FROM content_daily_stats cds
    WHERE cds.tenant_id = sqlc.arg('tenant_id')
        AND cds.entity_type = 'series'
        AND (sqlc.narg('series_id')::uuid IS NULL OR cds.entity_id = sqlc.narg('series_id')::uuid)
        AND cds.stat_date BETWEEN sqlc.arg('start_date')::date AND sqlc.arg('end_date')::date
    GROUP BY cds.entity_id
), audience AS (
    SELECT
        s.id AS series_id,
        s.public_id AS series_public_id,
        (COALESCE(sfc.count, 0) - COALESCE(ch.after_period, 0))::bigint AS follower_count,
        COALESCE(ch.followed_count, 0)::bigint AS followed_count,
        COALESCE(ch.unfollowed_count, 0)::bigint AS unfollowed_count,
        COALESCE(st.view_count, 0)::bigint AS view_count,
        COALESCE(st.complete_count, 0)::bigint AS complete_count,
        COALESCE(st.reaction_count, 0)::bigint AS reaction_count,
        COALESCE(st.reaction_points, 0)::bigint AS reaction_points
    FROM series s
    LEFT JOIN series_follower_counts sfc ON sfc.tenant_id = s.tenant_id AND sfc.series_id = s.id
    LEFT JOIN changes ch ON ch.series_id = s.id
    LEFT JOIN stats st ON st.series_id = s.id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND (sqlc.narg('series_id')::uuid IS NULL OR s.id = sqlc.narg('series_id')::uuid)
), page AS (
    SELECT *
    FROM audience a
    WHERE (
            sqlc.narg('cursor_series_id')::uuid IS NULL
            OR (
                sqlc.arg('cursor_inclusive')::boolean
                AND (a.follower_count, a.series_id) >= (
                    sqlc.narg('cursor_follower_count')::bigint,
                    sqlc.narg('cursor_series_id')::uuid
                )
            )
            OR (
                NOT sqlc.arg('cursor_inclusive')::boolean
                AND (a.follower_count, a.series_id) > (
                    sqlc.narg('cursor_follower_count')::bigint,
                    sqlc.narg('cursor_series_id')::uuid
                )
            )
        )
    ORDER BY a.follower_count ASC, a.series_id ASC
    LIMIT sqlc.arg('limit')
)
SELECT
    p.series_id,
    p.series_public_id,
    str.title AS series_title,
    p.follower_count,
    p.followed_count,
    p.unfollowed_count,
    p.view_count,
    p.complete_count,
    p.reaction_count,
    p.reaction_points,
    r.rating_count::bigint AS rating_count,
    r.rating_average::double precision AS rating_average
FROM page p
CROSS JOIN LATERAL series_translation_for(p.series_id, '') str
CROSS JOIN LATERAL series_rating(sqlc.arg('tenant_id')::uuid, p.series_id) r
ORDER BY p.follower_count ASC, p.series_id ASC;
