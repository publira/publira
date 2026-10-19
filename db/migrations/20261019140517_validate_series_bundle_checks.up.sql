-- Validates the CHECK constraints and the foreign key the previous migration
-- added NOT VALID. It is a file of its own because golang-migrate runs one file
-- as one transaction: on its own, VALIDATE CONSTRAINT takes SHARE UPDATE
-- EXCLUSIVE, which lets reads and writes go on while it scans the table.
ALTER TABLE ONLY series_listings
    VALIDATE CONSTRAINT series_listings_bundle_discount_percent_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_item_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_tenant_series_bundle_id_fkey;
