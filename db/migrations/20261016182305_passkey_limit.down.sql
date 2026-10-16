ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_passkey_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN passkey_limit_per_day,
    DROP COLUMN passkey_limit_per_minute;
