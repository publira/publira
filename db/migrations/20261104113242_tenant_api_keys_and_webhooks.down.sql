ALTER TABLE ONLY platform_policy_config
    DROP CONSTRAINT platform_policy_config_api_key_request_limit_check;

ALTER TABLE platform_policy_config
    DROP COLUMN api_key_request_limit_per_day,
    DROP COLUMN api_key_request_limit_per_minute;

DROP TABLE webhook_deliveries;

DROP TABLE tenant_webhook_endpoints;

DROP TABLE tenant_api_keys;
