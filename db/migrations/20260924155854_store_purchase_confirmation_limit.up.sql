-- How often one reader may hand a store transaction to ConfirmStorePurchase.
-- Each confirmation the server has not seen is verified with the App Store or
-- Google Play on the tenant's credentials, so an unbounded caller would spend
-- the tenant's API quota.

-- COLUMN: platform_policy_config store_purchase_confirm_limit_per_minute
-- COLUMN: platform_policy_config store_purchase_confirm_limit_per_day
-- A saved row gets the built-in defaults, which is what it enforced before the
-- limit existed as a setting. The defaults are then dropped: no value column of
-- this table has one, so an insert that forgets a value fails.
ALTER TABLE platform_policy_config
    ADD COLUMN store_purchase_confirm_limit_per_minute integer DEFAULT 10 NOT NULL,
    ADD COLUMN store_purchase_confirm_limit_per_day integer DEFAULT 100 NOT NULL;

ALTER TABLE platform_policy_config
    ALTER COLUMN store_purchase_confirm_limit_per_minute DROP DEFAULT,
    ALTER COLUMN store_purchase_confirm_limit_per_day DROP DEFAULT;

-- CONSTRAINT: platform_policy_config platform_policy_config_store_purchase_confirm_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_store_purchase_confirm_limit_check CHECK (((store_purchase_confirm_limit_per_minute >= 1) AND (store_purchase_confirm_limit_per_day >= store_purchase_confirm_limit_per_minute)));
