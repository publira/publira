-- COLUMN: platform_policy_config push_device_limit_per_minute
-- COLUMN: platform_policy_config push_device_limit_per_day
-- How often one reader may ask NotificationService.RegisterPushDevice or
-- UnregisterPushDevice to add or remove a push destination. Each registration
-- writes a row the worker sends every notification for that reader to. These
-- keep their defaults: the previous release's insert does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN push_device_limit_per_minute integer DEFAULT 10 NOT NULL,
    ADD COLUMN push_device_limit_per_day integer DEFAULT 50 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_push_device_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_push_device_limit_check CHECK (((push_device_limit_per_minute >= 1) AND (push_device_limit_per_day >= push_device_limit_per_minute)));
