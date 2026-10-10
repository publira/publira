-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_availability_check,
    ADD CONSTRAINT notifications_availability_check CHECK ((availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;
