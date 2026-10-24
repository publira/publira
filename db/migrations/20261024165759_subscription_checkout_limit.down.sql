ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_subscription_checkout_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN subscription_checkout_limit_per_day,
    DROP COLUMN subscription_checkout_limit_per_minute;
