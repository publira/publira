ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_login_source_limit_check;

ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_login_account_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN login_source_limit_per_day,
    DROP COLUMN login_source_limit_per_hour,
    DROP COLUMN login_account_limit_per_day,
    DROP COLUMN login_account_limit_per_minute;
