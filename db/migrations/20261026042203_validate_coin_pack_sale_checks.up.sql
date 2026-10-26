-- Validates the CHECK constraints and the foreign keys the previous migration
-- added NOT VALID. It is a file of its own because golang-migrate runs one file
-- as one transaction: on its own, VALIDATE CONSTRAINT takes SHARE UPDATE
-- EXCLUSIVE, which lets reads and writes go on while it scans the table.
ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_item_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_tenant_coin_pack_id_fkey;

ALTER TABLE ONLY store_purchase_intents
    VALIDATE CONSTRAINT store_purchase_intents_item_check;

ALTER TABLE ONLY store_purchase_intents
    VALIDATE CONSTRAINT store_purchase_intents_tenant_coin_pack_id_fkey;
