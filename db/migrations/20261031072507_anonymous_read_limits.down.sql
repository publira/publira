ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_anonymous_read_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN anonymous_read_images_limit_per_10_seconds,
    DROP COLUMN anonymous_read_search_limit_per_10_seconds,
    DROP COLUMN anonymous_read_public_api_limit_per_10_seconds;
