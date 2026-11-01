-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY announcements
    DROP CONSTRAINT announcements_audience_check,
    ADD CONSTRAINT announcements_audience_check CHECK (((audience IS NULL) OR ((jsonb_typeof(audience) = 'object'::text) AND (NOT pinned) AND (delivery = 'preferred'::text)))) NOT VALID;
