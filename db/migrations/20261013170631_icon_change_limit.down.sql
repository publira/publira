ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_icon_change_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN icon_change_limit_per_day,
    DROP COLUMN icon_change_limit_per_minute;
