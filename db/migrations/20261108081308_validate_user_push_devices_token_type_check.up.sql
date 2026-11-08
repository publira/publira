-- Validates the CHECK constraint the previous migration added NOT VALID. It is
-- a file of its own because golang-migrate runs one file as one transaction: on
-- its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads
-- and writes go on while it scans the table.
ALTER TABLE ONLY user_push_devices
    VALIDATE CONSTRAINT user_push_devices_token_type_check;
