-- A validated constraint cannot be marked NOT VALID again, so each one is
-- recreated as the previous migration left it.
ALTER TABLE ONLY episodes
    DROP CONSTRAINT episodes_purchase_availability_check,
    ADD CONSTRAINT episodes_purchase_availability_check CHECK ((purchase_availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;

ALTER TABLE ONLY series
    DROP CONSTRAINT series_purchase_availability_check,
    ADD CONSTRAINT series_purchase_availability_check CHECK ((purchase_availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;

ALTER TABLE ONLY tenant_config
    DROP CONSTRAINT tenant_config_google_play_url_check,
    ADD CONSTRAINT tenant_config_google_play_url_check CHECK (((google_play_url IS NULL) OR (google_play_url ~ '^https://[^[:space:]]+$'::text))) NOT VALID,
    DROP CONSTRAINT tenant_config_app_store_url_check,
    ADD CONSTRAINT tenant_config_app_store_url_check CHECK (((app_store_url IS NULL) OR (app_store_url ~ '^https://[^[:space:]]+$'::text))) NOT VALID,
    DROP CONSTRAINT tenant_config_purchase_availability_check,
    ADD CONSTRAINT tenant_config_purchase_availability_check CHECK ((purchase_availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;
