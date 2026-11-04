-- Validates the CHECK constraints and the foreign keys the previous migration
-- added NOT VALID. It is a file of its own because golang-migrate runs one file
-- as one transaction: on its own, VALIDATE CONSTRAINT takes SHARE UPDATE
-- EXCLUSIVE, which lets reads and writes go on while it scans the table.
ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_list_price_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_promotion_code_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_tenant_promotion_code_id_fkey;

ALTER TABLE ONLY store_purchase_intents
    VALIDATE CONSTRAINT store_purchase_intents_promotion_code_check;

ALTER TABLE ONLY store_purchase_intents
    VALIDATE CONSTRAINT store_purchase_intents_tenant_promotion_code_id_fkey;
