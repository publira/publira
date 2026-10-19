ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_series_remainder_checkout_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN series_remainder_checkout_limit_per_day,
    DROP COLUMN series_remainder_checkout_limit_per_minute;
