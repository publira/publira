-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the subscription payments migration left it.
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_source_check,
    ADD CONSTRAINT royalty_statement_lines_source_check CHECK ((source = ANY (ARRAY['sale'::text, 'subscription'::text]))) NOT VALID;
