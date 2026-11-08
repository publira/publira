-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY user_push_devices
    DROP CONSTRAINT user_push_devices_token_type_check,
    ADD CONSTRAINT user_push_devices_token_type_check CHECK (((token_type)::text = 'registration_token'::text) OR (((token_type)::text = 'installation_id'::text) AND ((platform)::text = ANY ((ARRAY['android'::character varying, 'ios'::character varying])::text[])))) NOT VALID;
