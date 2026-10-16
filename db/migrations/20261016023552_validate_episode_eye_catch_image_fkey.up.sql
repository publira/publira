-- Validates the episode eye-catch foreign key the previous migration added
-- NOT VALID. It is a file of its own because golang-migrate runs one file as
-- one transaction: validated alongside the ADD CONSTRAINT, the scan of
-- episodes would still be held under that file's locks. On its own, VALIDATE
-- CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads and writes go on.
ALTER TABLE ONLY episodes
    VALIDATE CONSTRAINT episodes_tenant_eye_catch_image_id_fkey;
