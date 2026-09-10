-- Episode ratings and the public tally kept beside them. Every statement here
-- runs on the reader's own connection: episode_ratings is member-isolated, so a
-- rating is written and read under the reader whose rating it is.
--
-- Nothing here raises or lowers episode_rating_counts. That is the trigger's
-- job (see the migration): a rating also goes when the reader's account does,
-- and that delete is PostgreSQL's own, with no statement of ours to carry a
-- matching decrement.
--
-- Nothing here aggregates either. The points a rating is worth reach the daily
-- stats through the 'rating' content event, which content_daily_stats has
-- summed per episode since the engagement schema landed.

-- name: RateEpisode :one
-- Records the rating, or raises the one already there, and answers with the
-- score as it now stands.
--
-- `points` is what this call adds, already resolved from the press mode by the
-- caller: the whole 5 in `single` mode, the presses reported in `multiple`. The
-- score is clamped at 5, so a reader who is already there presses to no effect
-- and the returned score tells the caller nothing was added.
--
-- The caller resolves the episode through the published catalog query first, so
-- publication and body access are settled before this runs.
INSERT INTO episode_ratings (tenant_id, user_id, episode_id, score)
VALUES (
    sqlc.arg('tenant_id'),
    sqlc.arg('user_id'),
    sqlc.arg('episode_id'),
    LEAST(sqlc.arg('points')::smallint, 5::smallint)
)
ON CONFLICT (tenant_id, user_id, episode_id) DO UPDATE
SET score = LEAST(episode_ratings.score + sqlc.arg('points')::smallint, 5::smallint)
RETURNING *;

-- name: GetMyEpisodeRating :one
-- The score this reader has given the episode, or no row when they have not
-- rated it.
SELECT er.score
FROM episode_ratings er
WHERE er.tenant_id = sqlc.arg('tenant_id')
    AND er.user_id = sqlc.arg('user_id')
    AND er.episode_id = sqlc.arg('episode_id');

-- name: GetEpisodeRatingCount :one
-- How many readers have rated the episode. Zero for one with no tally row,
-- which is every episode until the first rating arrives. Read after the rating
-- in the same transaction, so it carries whatever the trigger just made of it.
SELECT COALESCE((
    SELECT erc.count
    FROM episode_rating_counts erc
    WHERE erc.tenant_id = sqlc.arg('tenant_id')
        AND erc.episode_id = sqlc.arg('episode_id')
), 0)::bigint AS count;

-- name: GetEpisodeRatingMode :one
-- Which press mode governs this episode: the series' own answer when it has
-- one, and the tenant's otherwise.
--
-- Both joins are outer. A series carries no listing row until the console
-- writes one, and a tenant carries no config row until it changes a setting;
-- neither absence is a statement, so both fall through to the same default the
-- column carries.
SELECT COALESCE(
    sl.episode_rating_mode,
    tc.episode_rating_mode,
    'single'
)::text AS episode_rating_mode
FROM episodes e
    LEFT JOIN series_listings sl ON sl.tenant_id = e.tenant_id AND sl.series_id = e.series_id
    LEFT JOIN tenant_config tc ON tc.tenant_id = e.tenant_id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('episode_id');
