-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_store_transaction_check,
    ADD CONSTRAINT purchases_store_transaction_check CHECK ((((store IS NULL) = (store_transaction_id IS NULL)) AND ((NOT is_test) OR (store IS NOT NULL) OR (provider IS NOT NULL)))) NOT VALID;
