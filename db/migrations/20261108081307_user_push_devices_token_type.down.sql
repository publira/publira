ALTER TABLE ONLY user_push_devices
    DROP CONSTRAINT IF EXISTS user_push_devices_token_type_check,
    DROP COLUMN IF EXISTS token_type;
