-- What a series is rated, and what one reader's own reactions say about it.
--
-- There is no series rating to store: a reader rates a series by reacting to
-- its episodes, so the figure is derived. Both halves of the division are the
-- signed-in cohort content_daily_stats already measures complete_count and
-- member_view_count over — a reaction needs a session, and a completed read is
-- recorded for a member — so the rate they form compares like with like.

-- name: GetSeriesRating :one
-- The series' figure and the readers behind it. How the figure is formed is
-- the series_rating function's to say.
SELECT
    r.rating_count::bigint AS rating_count,
    r.rating_average::double precision AS rating_average
FROM series_rating(sqlc.arg('tenant_id')::uuid, sqlc.arg('series_id')::uuid) r;

-- name: GetMySeriesRating :one
-- What this reader's own reactions say about the series: the mean of the scores
-- they gave, over the episodes they reacted to and no others. A reader who
-- finished an episode without reacting is not in this divisor, which is where
-- it parts from the public figure — this is the reader's own statement rather
-- than a rate over a cohort, so it is neither shrunk nor held to a floor.
--
-- It runs on the reader's own connection: episode_ratings is member-isolated,
-- so the rows this reads are theirs by the policy rather than by the predicate.
SELECT
    COALESCE(round(avg(er.score), 1), 0)::double precision AS rating_average,
    count(*)::int4 AS rated_episode_count
FROM episode_ratings er
    JOIN episodes e ON e.tenant_id = er.tenant_id AND e.id = er.episode_id
WHERE er.tenant_id = sqlc.arg('tenant_id')
    AND er.user_id = sqlc.arg('user_id')
    AND e.series_id = sqlc.arg('series_id');
