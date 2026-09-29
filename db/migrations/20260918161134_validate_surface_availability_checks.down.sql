-- A validated constraint cannot be marked NOT VALID again, so each one is
-- recreated as the previous migration left it.
ALTER TABLE ONLY episodes
    DROP CONSTRAINT episodes_availability_check,
    ADD CONSTRAINT episodes_availability_check CHECK ((availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;

ALTER TABLE ONLY series
    DROP CONSTRAINT series_availability_check,
    ADD CONSTRAINT series_availability_check CHECK ((availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;
