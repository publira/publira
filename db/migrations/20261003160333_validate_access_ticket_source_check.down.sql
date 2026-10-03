-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY access_tickets
    DROP CONSTRAINT access_tickets_source_check,
    ADD CONSTRAINT access_tickets_source_check CHECK ((source = ANY (ARRAY['staff'::text, 'wait_free'::text]))) NOT VALID;
