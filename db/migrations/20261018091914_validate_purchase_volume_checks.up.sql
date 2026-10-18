-- Validates the CHECK and the foreign key the previous migration added to
-- purchases NOT VALID. It is a file of its own because golang-migrate runs one
-- file as one transaction: on its own, VALIDATE CONSTRAINT takes SHARE UPDATE
-- EXCLUSIVE, which lets reads and writes go on while it scans the table.
ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_item_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_tenant_volume_id_fkey;
