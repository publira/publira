-- Records what an FCM registration's token is, so the worker can name the
-- target field FCM addresses it by.
--
-- The column defaults to a registration token, so the previous release's
-- INSERT, which names no type, goes on recording what that release's app
-- registers. Its CHECK constraint is added NOT VALID so this file takes its
-- ACCESS EXCLUSIVE lock without scanning the table; the next migration
-- validates it under a lock that lets reads and writes continue.

-- COLUMN: user_push_devices token_type
-- 'registration_token' is the token FCM handed the app; 'installation_id' is
-- the install's Firebase Installation ID (FID), which the app registers from
-- firebase_messaging 17. A Web Push row keeps the default: its token is the
-- subscription endpoint, which no FCM target names, and only an Android or iOS
-- row may hold an FID.
ALTER TABLE ONLY user_push_devices
    ADD COLUMN token_type character varying(32) DEFAULT 'registration_token'::character varying NOT NULL,
    ADD CONSTRAINT user_push_devices_token_type_check CHECK (((token_type)::text = 'registration_token'::text) OR (((token_type)::text = 'installation_id'::text) AND ((platform)::text = ANY ((ARRAY['android'::character varying, 'ios'::character varying])::text[])))) NOT VALID;
