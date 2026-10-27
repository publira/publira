-- Validates the CHECK constraint the previous migration added NOT VALID. It is
-- a file of its own because golang-migrate runs one file as one transaction: on
-- its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads
-- and writes go on while it scans the table.
ALTER TABLE ONLY tenant_image_variants
    VALIDATE CONSTRAINT tenant_image_variants_variant_type_check;
