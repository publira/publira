ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_store_purchase_confirm_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN store_purchase_confirm_limit_per_day,
    DROP COLUMN store_purchase_confirm_limit_per_minute;
