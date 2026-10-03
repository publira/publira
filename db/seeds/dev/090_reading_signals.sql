-- The member's recent reading, and the recommendation features the daily
-- batch builds from it, so My Page's Recommended section and the storefront's
-- recommendation shelf order the catalogue for this reader rather than giving
-- them the order a guest gets.
--
-- The reading is two all-ages series whose label holds no rated series: six
-- views of Seed Series 030 and three of Seed Series 014. Every series ending in
-- 0 shares 030's label, and the ones that also share its genre or tag score
-- highest, so the shelf opens on Seed Series 090 and its first row holds no
-- rated cover a reader has to confirm their age for. The two series read
-- themselves sort behind every other one, because the reader has found them
-- already.
--
-- The events are dated two to ten days before the tenant's own today as of
-- when this file is applied, inside the batch's 28-day window. Yesterday is
-- left empty on purpose: the worker's first pass on a tenant aggregates its
-- yesterday into content stats and rankings, and a chart of two series would
-- take the storefront's recommendation shelf away.
--
-- The feature row is written here rather than left to the worker, which runs
-- the batch only once the rankings have moved past it. It is built from the
-- member's events by the batch's own aggregation, narrowed to this one reader,
-- so the worker's rebuild of the same window writes the same row, and
-- TestDevSeedRecommendFeaturesMatchTheBatch keeps the two from drifting.

-- Applying the file again re-dates the events rather than adding to them. A
-- view the member made in the same half hour as a seeded one is kept, and the
-- seeded view it collides with on the debounce index is not written.
DELETE FROM content_events
WHERE id BETWEEN '018f0e90-0000-7000-8000-000000000001'::uuid
    AND '018f0e90-0000-7000-8000-0000000000ff'::uuid;

WITH scope AS (
    SELECT
        t.id AS tenant_id,
        t.timezone,
        u.id AS user_id,
        (now() AT TIME ZONE t.timezone)::date AS today
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
    WHERE t.public_id = 'SeedTNNTAAA1'
),
-- Each row is one view: the number in `Seed Series NNN`, the episode number
-- for an episode view or NULL for the series page, and when, as days before
-- today and a local time of day.
event_seed (n, series_number, episode_number, days_ago, time_of_day) AS (
    VALUES
        (1, 30, NULL, 7, TIME '20:00'),
        (2, 30, 1, 7, TIME '20:05'),
        (3, 30, 2, 6, TIME '20:00'),
        (4, 30, 3, 5, TIME '20:00'),
        (5, 30, 4, 3, TIME '20:00'),
        (6, 30, 5, 2, TIME '20:00'),
        (7, 14, NULL, 10, TIME '21:00'),
        (8, 14, 1, 10, TIME '21:05'),
        (9, 14, 2, 9, TIME '21:00')
),
event_row AS (
    SELECT
        es.n,
        s.id AS series_id,
        e.id AS episode_id,
        ((scope.today - es.days_ago) + es.time_of_day) AT TIME ZONE scope.timezone AS occurred_at
    FROM event_seed es
    CROSS JOIN scope
    JOIN series s
        ON s.tenant_id = scope.tenant_id
        AND s.title = FORMAT('Seed Series %s', LPAD(es.series_number::text, 3, '0'))
    LEFT JOIN episodes e
        ON e.series_id = s.id
        AND e.title = FORMAT(
            'Seed Episode %s-%s',
            LPAD(es.series_number::text, 3, '0'),
            LPAD(es.episode_number::text, 2, '0')
        )
)
INSERT INTO content_events (
    id,
    tenant_id,
    event_type,
    user_id,
    series_id,
    episode_id,
    debounce_bucket,
    payload,
    occurred_at,
    created_at
)
SELECT
    ('018f0e90-0000-7000-8000-' || LPAD(TO_HEX(er.n), 12, '0'))::uuid,
    scope.tenant_id,
    CASE WHEN er.episode_id IS NULL THEN 'series_view' ELSE 'episode_view' END,
    scope.user_id,
    er.series_id,
    er.episode_id,
    -- The request path's half-hour debounce bucket of the moment.
    FLOOR(EXTRACT(EPOCH FROM er.occurred_at) / 1800)::bigint,
    '{"pv_kind":"soft"}'::jsonb,
    er.occurred_at,
    er.occurred_at
FROM event_row er
CROSS JOIN scope
ON CONFLICT DO NOTHING;

-- recommendfeatures.insertUserFeaturesSQL for the member alone, with the
-- window ending on the tenant's yesterday as the worker's pass does, the
-- default 28 days and 10 series, and the current FeatureVersion.
DELETE FROM user_recommend_features urf
USING tenants t, users u
WHERE t.public_id = 'SeedTNNTAAA1'
    AND u.tenant_id = t.id
    AND u.email = 'member@example.com'
    AND urf.tenant_id = t.id
    AND urf.user_id = u.id;

WITH bounds AS (
    SELECT
        t.id AS tenant_id,
        t.timezone,
        u.id AS user_id,
        (now() AT TIME ZONE t.timezone)::date - 1 - 27 AS window_start,
        (now() AT TIME ZONE t.timezone)::date - 1 AS window_end
    FROM tenants t
    JOIN users u ON u.tenant_id = t.id AND u.email = 'member@example.com'
    WHERE t.public_id = 'SeedTNNTAAA1'
),
windowed_events AS (
    SELECT ce.user_id, ce.series_id, ce.event_type, ce.rating_score, ce.occurred_at
    FROM content_events ce
    JOIN bounds b ON b.tenant_id = ce.tenant_id AND b.user_id = ce.user_id
    WHERE ce.occurred_at >= (b.window_start::timestamp AT TIME ZONE b.timezone)
        AND ce.occurred_at < ((b.window_end + 1)::timestamp AT TIME ZONE b.timezone)
),
per_series AS (
    SELECT
        user_id,
        series_id,
        count(*)::bigint AS event_count,
        count(*) FILTER (WHERE event_type IN ('episode_view', 'series_view'))::bigint AS view_count,
        count(*) FILTER (WHERE event_type = 'purchase')::bigint AS purchase_count,
        count(*) FILTER (WHERE event_type = 'rating')::bigint AS rating_count,
        COALESCE(sum(rating_score) FILTER (WHERE event_type = 'rating'), 0)::bigint AS rating_sum,
        count(*) FILTER (WHERE event_type = 'favorite')::bigint AS favorite_count,
        count(*) FILTER (WHERE event_type = 'comment')::bigint AS comment_count,
        max(occurred_at) AS last_event_at
    FROM windowed_events
    GROUP BY user_id, series_id
),
ranked_series AS (
    SELECT
        per_series.*,
        row_number() OVER (
            PARTITION BY user_id
            ORDER BY event_count DESC, purchase_count DESC, series_id
        ) AS position
    FROM per_series
),
top_series AS (
    SELECT
        user_id,
        jsonb_agg(
            jsonb_build_object(
                'series_id', series_id,
                'event_count', event_count,
                'view_count', view_count,
                'purchase_count', purchase_count,
                'rating_count', rating_count,
                'rating_sum', rating_sum,
                'favorite_count', favorite_count,
                'comment_count', comment_count,
                'last_event_at', to_char(last_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
            )
            ORDER BY position
        ) AS series
    FROM ranked_series
    WHERE position <= 10
    GROUP BY user_id
),
totals AS (
    SELECT
        user_id,
        sum(event_count)::bigint AS event_count,
        sum(view_count)::bigint AS view_count,
        sum(purchase_count)::bigint AS purchase_count,
        sum(rating_count)::bigint AS rating_count,
        sum(rating_sum)::bigint AS rating_sum,
        sum(favorite_count)::bigint AS favorite_count,
        sum(comment_count)::bigint AS comment_count,
        count(*)::bigint AS series_count,
        max(last_event_at) AS last_event_at
    FROM per_series
    GROUP BY user_id
)
INSERT INTO user_recommend_features (
    tenant_id, user_id, features, feature_version, computed_at
)
SELECT
    b.tenant_id,
    t.user_id,
    jsonb_build_object(
        'window_days', 28,
        'window_start', to_char(b.window_start, 'YYYY-MM-DD'),
        'window_end', to_char(b.window_end, 'YYYY-MM-DD'),
        'event_count', t.event_count,
        'view_count', t.view_count,
        'purchase_count', t.purchase_count,
        'rating_count', t.rating_count,
        'rating_sum', t.rating_sum,
        'favorite_count', t.favorite_count,
        'comment_count', t.comment_count,
        'series_count', t.series_count,
        'last_event_at', to_char(t.last_event_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'top_series', COALESCE(ts.series, '[]'::jsonb)
    ),
    2,
    now()
FROM totals t
JOIN bounds b ON b.user_id = t.user_id
LEFT JOIN top_series ts ON ts.user_id = t.user_id;
