-- The console's drop-off report: how far into one episode its readers got over
-- a period of the tenant's days, from the episode_page_reach_stats rows
-- aggregate-content-stats rebuilds. Those rows are already tenant days, so the
-- period is a range of stat_date and needs no zone.

-- name: GetEpisodePageCountByPublicID :one
-- The episode a report names, and the pages it has now.
SELECT e.id,
    (
        SELECT count(*)
        FROM episode_images ei
        WHERE ei.episode_id = e.id
    )::integer AS page_count
FROM episodes e
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.public_id = sqlc.arg('public_id');

-- name: ListEpisodePageReach :many
-- Every page from the first through the episode's last, page_count - 1, or
-- through the furthest page reached in the period if that is further, so a
-- chart of it has no gap to fill. A day's rows already reach from page 0 to
-- that day's furthest page, so summing them over the period is the readers of
-- every day of it who reached the page.
WITH reach AS (
    SELECT eprs.page_index,
        sum(eprs.reader_count)::bigint AS reader_count
    FROM episode_page_reach_stats eprs
    WHERE eprs.tenant_id = sqlc.arg('tenant_id')
        AND eprs.episode_id = sqlc.arg('episode_id')
        AND eprs.stat_date BETWEEN sqlc.arg('start_date')::date AND sqlc.arg('end_date')::date
    GROUP BY eprs.page_index
)
SELECT p.page_index::integer AS page_index,
    COALESCE(r.reader_count, 0)::bigint AS reader_count
FROM generate_series(
        0,
        GREATEST(
            sqlc.arg('page_count')::integer,
            COALESCE((SELECT max(reach.page_index) + 1 FROM reach), 0)
        ) - 1
    ) AS p(page_index)
    LEFT JOIN reach r ON r.page_index = p.page_index
ORDER BY p.page_index;
