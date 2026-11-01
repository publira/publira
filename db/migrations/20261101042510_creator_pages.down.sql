DROP TRIGGER IF EXISTS creator_follows_record_unfollow ON creator_follows;
DROP TRIGGER IF EXISTS creator_follows_record_follow ON creator_follows;
DROP FUNCTION IF EXISTS creator_follows_record_change();
DROP TABLE IF EXISTS creator_follower_counts;

ALTER TABLE tenant_config
    DROP COLUMN IF EXISTS creator_pages_show_sales,
    DROP COLUMN IF EXISTS creator_pages_enabled;
