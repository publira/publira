DROP TABLE store_purchase_intents;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_store_transaction_check,
    DROP CONSTRAINT purchases_store_check;

ALTER TABLE purchases
    DROP COLUMN is_test,
    DROP COLUMN store_transaction_id,
    DROP COLUMN store;
