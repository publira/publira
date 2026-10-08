-- The previous constraint is restored NOT VALID: a provider purchase recorded
-- as a test one in the meantime breaks it, and it keeps its flag so the
-- royalty statements and the daily stats, which read the flag alone, go on
-- leaving it out.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_store_transaction_check,
    ADD CONSTRAINT purchases_store_transaction_check CHECK ((((store IS NULL) = (store_transaction_id IS NULL)) AND ((NOT is_test) OR (store IS NOT NULL)))) NOT VALID;
