-- A validated constraint cannot be marked NOT VALID again, so each is recreated
-- as the tips migration left it.
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_source_check,
    ADD CONSTRAINT royalty_statement_lines_source_check CHECK ((source = ANY (ARRAY['sale'::text, 'subscription'::text, 'tip'::text]))) NOT VALID;

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_kind_check,
    ADD CONSTRAINT store_purchase_intents_kind_check CHECK (((kind = ANY (ARRAY['purchase'::text, 'tip'::text])) AND ((kind <> 'tip'::text) OR ((episode_id IS NOT NULL) AND (reading_period_hours IS NULL))))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tip_check,
    ADD CONSTRAINT purchases_tip_check CHECK (((kind <> 'tip'::text) OR ((episode_id IS NOT NULL) AND (expires_at IS NULL)))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_kind_check,
    ADD CONSTRAINT purchases_kind_check CHECK ((kind = ANY (ARRAY['rental'::text, 'purchase'::text, 'tip'::text]))) NOT VALID;
