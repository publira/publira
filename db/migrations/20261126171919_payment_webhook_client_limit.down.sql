ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_payment_webhook_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN payment_webhook_limit_per_client_per_day,
    DROP COLUMN payment_webhook_limit_per_client_per_minute;
