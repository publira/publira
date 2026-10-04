-- Validates the CHECK constraint the previous migration added NOT VALID. It is
-- a file of its own because golang-migrate runs one file as one transaction:
-- validated alongside the ADD CONSTRAINT, the scan would still be held under
-- that statement's ACCESS EXCLUSIVE lock. On its own, VALIDATE CONSTRAINT takes
-- SHARE UPDATE EXCLUSIVE, which lets reads and writes go on.
ALTER TABLE ONLY access_tickets
    VALIDATE CONSTRAINT access_tickets_source_check;
