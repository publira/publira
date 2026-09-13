ALTER TABLE user_push_devices
    DROP CONSTRAINT user_push_devices_web_subscription_check,
    DROP CONSTRAINT user_push_devices_web_subscription_byte_limit_check,
    DROP CONSTRAINT user_push_devices_platform_check,
    ADD CONSTRAINT user_push_devices_platform_check CHECK (platform IN ('android', 'ios')),
    DROP COLUMN auth,
    DROP COLUMN p256dh,
    DROP COLUMN endpoint;
