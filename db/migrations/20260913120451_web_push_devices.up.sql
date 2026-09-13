ALTER TABLE user_push_devices
    ADD COLUMN endpoint text,
    ADD COLUMN p256dh text,
    ADD COLUMN auth text,
    DROP CONSTRAINT user_push_devices_platform_check,
    ADD CONSTRAINT user_push_devices_platform_check CHECK (platform IN ('android', 'ios', 'web')),
    ADD CONSTRAINT user_push_devices_web_subscription_byte_limit_check CHECK (
        (endpoint IS NULL OR octet_length(endpoint) <= 1024)
        AND (p256dh IS NULL OR octet_length(p256dh) <= 1024)
        AND (auth IS NULL OR octet_length(auth) <= 1024)
    ),
    ADD CONSTRAINT user_push_devices_web_subscription_check CHECK (
        (platform = 'web' AND endpoint IS NOT NULL AND p256dh IS NOT NULL AND auth IS NOT NULL AND token = endpoint)
        OR (platform IN ('android', 'ios') AND endpoint IS NULL AND p256dh IS NULL AND auth IS NULL)
    );
