ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_push_device_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN push_device_limit_per_day,
    DROP COLUMN push_device_limit_per_minute;
