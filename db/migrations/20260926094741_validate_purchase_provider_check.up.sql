-- Validates the CHECK constraint the provider migration added NOT VALID, now
-- that every purchase already there names its provider. It is a file of its
-- own because golang-migrate runs one file as one transaction: on its own,
-- VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads and writes
-- go on while it scans the table.
ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_provider_check;
