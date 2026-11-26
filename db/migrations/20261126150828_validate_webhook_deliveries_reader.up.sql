-- Validates the foreign key the previous migration added NOT VALID. It is a
-- file of its own because golang-migrate runs one file as one transaction: on
-- its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads
-- and writes go on while it scans the table.
ALTER TABLE ONLY webhook_deliveries
    VALIDATE CONSTRAINT webhook_deliveries_tenant_reader_id_fkey;
