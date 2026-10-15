-- Validates the constraints the previous migration added NOT VALID. It is a
-- file of its own because golang-migrate runs one file as one transaction:
-- validated alongside the ADD CONSTRAINT, the scan of users would still be held
-- under that statement's ACCESS EXCLUSIVE lock. On its own, VALIDATE CONSTRAINT
-- takes SHARE UPDATE EXCLUSIVE on users, which lets reads and writes go on.
ALTER TABLE ONLY users
    VALIDATE CONSTRAINT users_tenant_icon_preset_id_fkey;

ALTER TABLE ONLY users
    VALIDATE CONSTRAINT users_icon_preset_id_tenant_check;

ALTER TABLE ONLY users
    VALIDATE CONSTRAINT users_one_icon_check;
