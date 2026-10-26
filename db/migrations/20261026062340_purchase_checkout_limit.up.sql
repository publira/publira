-- COLUMN: platform_policy_config purchase_checkout_limit_per_minute
-- COLUMN: platform_policy_config purchase_checkout_limit_per_day
-- How often one reader may ask PurchaseService.StartEpisodeCheckout,
-- StartVolumeCheckout, or CoinService.StartCoinPackCheckout to start a
-- checkout. None of them writes anything, but each one asks the payment
-- provider for a checkout on the tenant's credentials, so what this bounds is
-- the provider requests one account can make the storefront repeat. Unlike
-- most value columns these keep their defaults: the previous release's insert
-- does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN purchase_checkout_limit_per_minute integer DEFAULT 10 NOT NULL,
    ADD COLUMN purchase_checkout_limit_per_day integer DEFAULT 100 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_purchase_checkout_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_purchase_checkout_limit_check CHECK (((purchase_checkout_limit_per_minute >= 1) AND (purchase_checkout_limit_per_day >= purchase_checkout_limit_per_minute)));
