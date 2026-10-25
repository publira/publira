ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_coin_payment_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN coin_payment_limit_per_day,
    DROP COLUMN coin_payment_limit_per_minute;

DROP TABLE coin_spend_allocations;

DROP TABLE coin_transactions;

DROP TABLE coin_grants;
