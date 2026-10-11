-- A validated constraint cannot be marked NOT VALID again, so each is recreated
-- as the previous migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_currency_check,
    ADD CONSTRAINT purchases_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)) NOT VALID;

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_currency_check,
    ADD CONSTRAINT store_purchase_intents_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)) NOT VALID;
