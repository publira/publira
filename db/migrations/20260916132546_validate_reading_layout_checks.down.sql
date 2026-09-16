-- A validated constraint cannot be marked NOT VALID again, so each one is
-- recreated as the previous migration left it.
ALTER TABLE ONLY episodes
    DROP CONSTRAINT episodes_spread_start_index_check,
    DROP CONSTRAINT episodes_reading_direction_check,
    ADD CONSTRAINT episodes_reading_direction_check CHECK ((reading_direction = ANY (ARRAY['rtl'::text, 'ltr'::text]))) NOT VALID,
    ADD CONSTRAINT episodes_spread_start_index_check CHECK ((spread_start_index >= 0)) NOT VALID;

ALTER TABLE ONLY series_listings
    DROP CONSTRAINT series_listings_spread_start_index_check,
    DROP CONSTRAINT series_listings_reading_direction_check,
    ADD CONSTRAINT series_listings_reading_direction_check CHECK ((reading_direction = ANY (ARRAY['rtl'::text, 'ltr'::text]))) NOT VALID,
    ADD CONSTRAINT series_listings_spread_start_index_check CHECK ((spread_start_index >= 0)) NOT VALID;
