-- Take episode ratings back out. content_events and content_daily_stats were
-- never changed, so there is nothing to narrow and nothing to refuse over: the
-- rating events already filed stay where they are.
ALTER TABLE series_listings
    DROP CONSTRAINT series_listings_episode_rating_mode_check;

ALTER TABLE series_listings
    DROP COLUMN episode_rating_mode;

ALTER TABLE tenant_config
    DROP CONSTRAINT tenant_config_episode_rating_mode_check;

ALTER TABLE tenant_config
    DROP COLUMN episode_rating_mode;

-- The triggers go with the table they are on; the function they call does not.
DROP TABLE episode_rating_counts;

DROP TABLE episode_ratings;

DROP FUNCTION episode_rating_counts_follow_ratings();
