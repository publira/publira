-- COLUMN: platform_policy_config payment_webhook_limit_per_client_per_minute
-- COLUMN: platform_policy_config payment_webhook_limit_per_client_per_day
-- How many notifications one client may hand PurchaseService.
-- ProcessPaymentWebhook for one tenant through a payment provider that signs
-- none, each of which the server reads back from the provider's API on the
-- tenant's credentials. These keep their defaults: the previous release's
-- insert does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN payment_webhook_limit_per_client_per_minute integer DEFAULT 120 NOT NULL,
    ADD COLUMN payment_webhook_limit_per_client_per_day integer DEFAULT 10000 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_payment_webhook_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_payment_webhook_limit_check CHECK (((payment_webhook_limit_per_client_per_minute >= 1) AND (payment_webhook_limit_per_client_per_day >= payment_webhook_limit_per_client_per_minute)));
