DROP TRIGGER IF EXISTS series_follows_record_unfollow ON series_follows;
DROP TRIGGER IF EXISTS series_follows_record_follow ON series_follows;
DROP FUNCTION IF EXISTS series_follows_record_change();
DROP TABLE IF EXISTS series_follow_changes;
DROP TABLE IF EXISTS series_follower_counts;
