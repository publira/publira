ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_content_view_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN content_view_limit_per_client_per_day,
    DROP COLUMN content_view_limit_per_client_per_minute;
