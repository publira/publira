-- How often one reader may ask SubscriptionService.StartSubscriptionCheckout to
-- start a subscription checkout. Each start writes the reader's latest
-- checkout, may expire the one before it, and asks the payment provider for a
-- checkout, so what this bounds is the writes and the provider requests one
-- account can make the storefront repeat.

-- COLUMN: platform_policy_config subscription_checkout_limit_per_minute
-- COLUMN: platform_policy_config subscription_checkout_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforces from now
-- on. The defaults are then dropped: no value column of this table has one, so
-- an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN subscription_checkout_limit_per_minute integer DEFAULT 10 NOT NULL,
    ADD COLUMN subscription_checkout_limit_per_day integer DEFAULT 50 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN subscription_checkout_limit_per_minute DROP DEFAULT,
    ALTER COLUMN subscription_checkout_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_subscription_checkout_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_subscription_checkout_limit_check CHECK (((subscription_checkout_limit_per_minute >= 1) AND (subscription_checkout_limit_per_day >= subscription_checkout_limit_per_minute)));
