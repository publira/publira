-- A signed-in reader's own recommendation list, ordered from the features the
-- daily batch writes for them. The tenant-wide list every reader shares stays
-- with the other engagement reads in engagement.sql; this file is the half
-- that reads one reader.
--
-- Expected plans:
--   HasUserRecommendFeatures
--     -> user_recommend_features_pkey
--   ListMyRecommendedSeriesIDs / ListMyRecommendedSeriesIDsReversed
--     -> no index for the scan; scores one tenant's published series against
--        one reader's features (see the note there)

-- Whether the reader has features the current build of the batch wrote. A row
-- stamped with another feature_version is one an older build left behind, and
-- reads as no row at all rather than as features of the wrong shape.
-- name: HasUserRecommendFeatures :one
SELECT EXISTS (
        SELECT 1
        FROM user_recommend_features
        WHERE tenant_id = sqlc.arg('tenant_id')
            AND user_id = sqlc.arg('user_id')
            AND feature_version = sqlc.arg('feature_version')
    )::boolean AS has_features;

-- The keyset scan behind a signed-in reader's own recommendation list. It
-- scores every published series of the tenant against the series the reader
-- engaged with, as user_recommend_features.top_series names them, and orders
-- the whole catalogue by that score.
--
-- Each of the reader's series is worth what they did with it in the window:
-- 100 per purchase, 50 per comment, 40 per favourite, 8 per rating point and 5
-- per view. Those are contentranking's weights scaled by five, so a rating
-- point is a whole number and the reader's weighing of their own signals is
-- the one the tenant-wide ranking applies to everyone's. A candidate scores
-- the sum, over the reader's series other than itself, of that worth times
-- what the two share, by the 3 / 2 / 1 rule ListRelatedSeriesIDs scores by.
-- Excluding the candidate itself keeps a series from recommending itself: one
-- the reader engaged with is scored only by what it shares with their others.
--
-- The sort key is (engaged, score, popularity, published_at, id). engaged puts
-- the series the reader has already found behind the ones they have not. It is
-- read from the reader's own events since the window began rather than from
-- top_series alone: that list is capped at DefaultTopSeriesLimit, and a series
-- that fell off it is still one the reader has found. The events are bounded
-- by the start of the window the features cover, in the tenant's time zone as
-- the batch bounds them, and run on to now, so a series first opened after the
-- batch ran is already behind the rest. idx_content_events_tenant_user_occurred_at
-- keeps that one reader's slice of the table.
-- popularity is the tenant-wide engagement with the series over the same
-- window, from item_recommend_features and weighted alike, plus 10 per distinct
-- reader-day, the way the ranking counts a distinct viewer twice a view. Every
-- feature row is read only under the current feature_version, so an item row
-- an older build left behind counts as no engagement, not as one of another
-- shape. published_at and then id settle the rest, and id keeps the key
-- unique.
--
-- No index serves this: the leading sort keys are computed per row. The scan is
-- bounded by one tenant's published series, each scored by four lookups
-- against at most DefaultTopSeriesLimit reader series.
-- name: ListMyRecommendedSeriesIDs :many
WITH reader_series AS (
    SELECT (entry->>'series_id')::uuid AS series_id,
        sum(
            100 * (entry->>'purchase_count')::bigint
            + 50 * (entry->>'comment_count')::bigint
            + 40 * (entry->>'favorite_count')::bigint
            + 8 * (entry->>'rating_sum')::bigint
            + 5 * (entry->>'view_count')::bigint
        )::bigint AS weight
    FROM user_recommend_features urf
        CROSS JOIN LATERAL jsonb_array_elements(urf.features->'top_series') AS entry
    WHERE urf.tenant_id = sqlc.arg('tenant_id')
        AND urf.user_id = sqlc.arg('user_id')
        AND urf.feature_version = sqlc.arg('feature_version')
        AND entry->>'series_id' IS NOT NULL
    GROUP BY (entry->>'series_id')::uuid
),
reader_window AS (
    SELECT (urf.features->>'window_start')::date AS window_start
    FROM user_recommend_features urf
    WHERE urf.tenant_id = sqlc.arg('tenant_id')
        AND urf.user_id = sqlc.arg('user_id')
        AND urf.feature_version = sqlc.arg('feature_version')
),
engaged_series AS (
    SELECT series_id
    FROM reader_series
    UNION
    SELECT ce.series_id
    FROM content_events ce
        CROSS JOIN reader_window w
    WHERE ce.tenant_id = sqlc.arg('tenant_id')
        AND ce.user_id = sqlc.arg('user_id')
        AND ce.series_id IS NOT NULL
        AND ce.occurred_at >= (w.window_start::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
),
reader_labels AS (
    SELECT s.label_id,
        rs.series_id,
        rs.weight
    FROM reader_series rs
        JOIN series s ON s.id = rs.series_id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.label_id IS NOT NULL
),
candidate AS (
    SELECT s.id,
        s.published_at,
        (
            EXISTS (
                SELECT 1
                FROM engaged_series es
                WHERE es.series_id = s.id
            )
        )::int AS engaged,
        (
            3 * (
                SELECT COALESCE(sum(rs.weight), 0)
                FROM series_creators sc
                    JOIN series_creators rc ON rc.creator_id = sc.creator_id
                    JOIN reader_series rs ON rs.series_id = rc.series_id
                WHERE sc.series_id = s.id
                    AND rs.series_id <> s.id
            ) + 2 * (
                SELECT COALESCE(sum(rl.weight), 0)
                FROM reader_labels rl
                WHERE rl.label_id = s.label_id
                    AND rl.series_id <> s.id
            ) + (
                SELECT COALESCE(sum(rs.weight), 0)
                FROM series_genres sg
                    JOIN series_genres rg ON rg.genre_id = sg.genre_id
                    JOIN reader_series rs ON rs.series_id = rg.series_id
                WHERE sg.series_id = s.id
                    AND rs.series_id <> s.id
            ) + (
                SELECT COALESCE(sum(rs.weight), 0)
                FROM series_tags st
                    JOIN series_tags rt ON rt.tag_id = st.tag_id
                    JOIN reader_series rs ON rs.series_id = rt.series_id
                WHERE st.series_id = s.id
                    AND rs.series_id <> s.id
            )
        )::bigint AS score,
        COALESCE(
            100 * (irf.features->>'purchase_count')::bigint
            + 50 * (irf.features->>'comment_count')::bigint
            + 40 * (irf.features->>'favorite_count')::bigint
            + 8 * (irf.features->>'rating_sum')::bigint
            + 10 * (irf.features->>'viewer_days')::bigint
            + 5 * (irf.features->>'view_count')::bigint,
            0
        )::bigint AS popularity
    FROM series s
        LEFT JOIN item_recommend_features irf ON irf.tenant_id = s.tenant_id
        AND irf.entity_type = 'series'
        AND irf.entity_id = s.id
        AND irf.feature_version = sqlc.arg('feature_version')
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND EXISTS (
            SELECT 1
            FROM series_surfaces ss
            WHERE ss.series_id = s.id
                AND ss.surface = sqlc.arg('surface')::text
        )
)
SELECT id, engaged, score, popularity
FROM candidate
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR engaged > sqlc.narg('cursor_engaged')::int
        OR (
            engaged = sqlc.narg('cursor_engaged')::int
            AND (
                score < sqlc.narg('cursor_score')::bigint
                OR (
                    score = sqlc.narg('cursor_score')::bigint
                    AND (
                        popularity < sqlc.narg('cursor_popularity')::bigint
                        OR (
                            popularity = sqlc.narg('cursor_popularity')::bigint
                            AND (
                                (
                                    sqlc.arg('cursor_inclusive')::boolean
                                    AND (published_at, id) <= (
                                        sqlc.narg('cursor_published_at')::timestamptz,
                                        sqlc.narg('cursor_id')::uuid
                                    )
                                )
                                OR (
                                    NOT sqlc.arg('cursor_inclusive')::boolean
                                    AND (published_at, id) < (
                                        sqlc.narg('cursor_published_at')::timestamptz,
                                        sqlc.narg('cursor_id')::uuid
                                    )
                                )
                            )
                        )
                    )
                )
            )
        )
    )
ORDER BY engaged ASC,
    score DESC,
    popularity DESC,
    published_at DESC,
    id DESC
LIMIT sqlc.arg('limit');

-- ListMyRecommendedSeriesIDs walked the other way. It exists only to build a
-- previous page; the order it describes is the same one.
-- name: ListMyRecommendedSeriesIDsReversed :many
WITH reader_series AS (
    SELECT (entry->>'series_id')::uuid AS series_id,
        sum(
            100 * (entry->>'purchase_count')::bigint
            + 50 * (entry->>'comment_count')::bigint
            + 40 * (entry->>'favorite_count')::bigint
            + 8 * (entry->>'rating_sum')::bigint
            + 5 * (entry->>'view_count')::bigint
        )::bigint AS weight
    FROM user_recommend_features urf
        CROSS JOIN LATERAL jsonb_array_elements(urf.features->'top_series') AS entry
    WHERE urf.tenant_id = sqlc.arg('tenant_id')
        AND urf.user_id = sqlc.arg('user_id')
        AND urf.feature_version = sqlc.arg('feature_version')
        AND entry->>'series_id' IS NOT NULL
    GROUP BY (entry->>'series_id')::uuid
),
reader_window AS (
    SELECT (urf.features->>'window_start')::date AS window_start
    FROM user_recommend_features urf
    WHERE urf.tenant_id = sqlc.arg('tenant_id')
        AND urf.user_id = sqlc.arg('user_id')
        AND urf.feature_version = sqlc.arg('feature_version')
),
engaged_series AS (
    SELECT series_id
    FROM reader_series
    UNION
    SELECT ce.series_id
    FROM content_events ce
        CROSS JOIN reader_window w
    WHERE ce.tenant_id = sqlc.arg('tenant_id')
        AND ce.user_id = sqlc.arg('user_id')
        AND ce.series_id IS NOT NULL
        AND ce.occurred_at >= (w.window_start::timestamp AT TIME ZONE sqlc.arg('time_zone')::text)
),
reader_labels AS (
    SELECT s.label_id,
        rs.series_id,
        rs.weight
    FROM reader_series rs
        JOIN series s ON s.id = rs.series_id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.label_id IS NOT NULL
),
candidate AS (
    SELECT s.id,
        s.published_at,
        (
            EXISTS (
                SELECT 1
                FROM engaged_series es
                WHERE es.series_id = s.id
            )
        )::int AS engaged,
        (
            3 * (
                SELECT COALESCE(sum(rs.weight), 0)
                FROM series_creators sc
                    JOIN series_creators rc ON rc.creator_id = sc.creator_id
                    JOIN reader_series rs ON rs.series_id = rc.series_id
                WHERE sc.series_id = s.id
                    AND rs.series_id <> s.id
            ) + 2 * (
                SELECT COALESCE(sum(rl.weight), 0)
                FROM reader_labels rl
                WHERE rl.label_id = s.label_id
                    AND rl.series_id <> s.id
            ) + (
                SELECT COALESCE(sum(rs.weight), 0)
                FROM series_genres sg
                    JOIN series_genres rg ON rg.genre_id = sg.genre_id
                    JOIN reader_series rs ON rs.series_id = rg.series_id
                WHERE sg.series_id = s.id
                    AND rs.series_id <> s.id
            ) + (
                SELECT COALESCE(sum(rs.weight), 0)
                FROM series_tags st
                    JOIN series_tags rt ON rt.tag_id = st.tag_id
                    JOIN reader_series rs ON rs.series_id = rt.series_id
                WHERE st.series_id = s.id
                    AND rs.series_id <> s.id
            )
        )::bigint AS score,
        COALESCE(
            100 * (irf.features->>'purchase_count')::bigint
            + 50 * (irf.features->>'comment_count')::bigint
            + 40 * (irf.features->>'favorite_count')::bigint
            + 8 * (irf.features->>'rating_sum')::bigint
            + 10 * (irf.features->>'viewer_days')::bigint
            + 5 * (irf.features->>'view_count')::bigint,
            0
        )::bigint AS popularity
    FROM series s
        LEFT JOIN item_recommend_features irf ON irf.tenant_id = s.tenant_id
        AND irf.entity_type = 'series'
        AND irf.entity_id = s.id
        AND irf.feature_version = sqlc.arg('feature_version')
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND EXISTS (
            SELECT 1
            FROM series_surfaces ss
            WHERE ss.series_id = s.id
                AND ss.surface = sqlc.arg('surface')::text
        )
)
SELECT id, engaged, score, popularity
FROM candidate
WHERE (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR engaged < sqlc.narg('cursor_engaged')::int
        OR (
            engaged = sqlc.narg('cursor_engaged')::int
            AND (
                score > sqlc.narg('cursor_score')::bigint
                OR (
                    score = sqlc.narg('cursor_score')::bigint
                    AND (
                        popularity > sqlc.narg('cursor_popularity')::bigint
                        OR (
                            popularity = sqlc.narg('cursor_popularity')::bigint
                            AND (
                                (
                                    sqlc.arg('cursor_inclusive')::boolean
                                    AND (published_at, id) >= (
                                        sqlc.narg('cursor_published_at')::timestamptz,
                                        sqlc.narg('cursor_id')::uuid
                                    )
                                )
                                OR (
                                    NOT sqlc.arg('cursor_inclusive')::boolean
                                    AND (published_at, id) > (
                                        sqlc.narg('cursor_published_at')::timestamptz,
                                        sqlc.narg('cursor_id')::uuid
                                    )
                                )
                            )
                        )
                    )
                )
            )
        )
    )
ORDER BY engaged DESC,
    score ASC,
    popularity ASC,
    published_at ASC,
    id ASC
LIMIT sqlc.arg('limit');
