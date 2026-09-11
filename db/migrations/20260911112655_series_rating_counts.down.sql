-- Take the series tally back out. episode_ratings and its own tally are
-- untouched here, so the reactions the count was derived from survive the
-- rollback and a re-applied up migration counts them again.
DROP TRIGGER IF EXISTS episodes_release_ratings ON episodes;

DROP FUNCTION IF EXISTS episode_ratings_follow_episode_deletes();

DROP TRIGGER IF EXISTS episode_ratings_lower_series_count ON episode_ratings;

DROP TRIGGER IF EXISTS episode_ratings_raise_series_count ON episode_ratings;

DROP FUNCTION IF EXISTS series_rating_counts_follow_ratings();

DROP TABLE IF EXISTS series_rating_counts;
