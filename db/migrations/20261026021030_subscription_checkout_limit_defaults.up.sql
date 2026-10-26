-- COLUMN: platform_policy_config subscription_checkout_limit_per_minute
-- COLUMN: platform_policy_config subscription_checkout_limit_per_day
-- Like the coin payment limits these keep their defaults: the previous
-- release's insert does not name them, so without one its first save of the
-- policy fails on the NOT NULL.
ALTER TABLE platform_policy_config
    ALTER COLUMN subscription_checkout_limit_per_minute SET DEFAULT 10,
    ALTER COLUMN subscription_checkout_limit_per_day SET DEFAULT 50;
