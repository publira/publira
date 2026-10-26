ALTER TABLE platform_policy_config
    ALTER COLUMN subscription_checkout_limit_per_minute DROP DEFAULT,
    ALTER COLUMN subscription_checkout_limit_per_day DROP DEFAULT;
