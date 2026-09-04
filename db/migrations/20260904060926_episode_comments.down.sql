-- Dropping the column takes tenant_config_comment_mode_check with it.
ALTER TABLE tenant_config
    DROP COLUMN comment_mode;

DROP TABLE IF EXISTS episode_comments;
