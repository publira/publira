ALTER TABLE ONLY tenant_community_limit_overrides
    DROP CONSTRAINT tenant_community_limit_overrides_notification_settings_check;

ALTER TABLE tenant_community_limit_overrides
    DROP COLUMN notification_settings_limit_per_day,
    DROP COLUMN notification_settings_limit_per_minute;

ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_notification_settings_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN notification_settings_limit_per_day,
    DROP COLUMN notification_settings_limit_per_minute;
