-- The schema this returns to has no test provider purchase, and the code it
-- returns to records every provider purchase as a sale, so the ones recorded
-- as tests in the meantime become sales again: they keep opening the episode,
-- and the royalty statements and the daily stats count them as they did before
-- the flag was allowed on them. Leaving the flag in place behind a NOT VALID
-- constraint is not an option, since PostgreSQL checks such a constraint on
-- every later update of the row, and a refund of one of them would fail.
UPDATE purchases
SET is_test = false
WHERE is_test
    AND store IS NULL;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_store_transaction_check,
    ADD CONSTRAINT purchases_store_transaction_check CHECK ((((store IS NULL) = (store_transaction_id IS NULL)) AND ((NOT is_test) OR (store IS NOT NULL))));
