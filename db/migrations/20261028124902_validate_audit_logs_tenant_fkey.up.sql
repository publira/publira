-- Validates the audit log tenant foreign key the previous migration added
-- NOT VALID. It is a file of its own because golang-migrate runs one file as
-- one transaction: validated alongside the ADD CONSTRAINT, the scan of
-- audit_logs would still be held under that file's locks. On its own, VALIDATE
-- CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads and writes go on.
ALTER TABLE ONLY audit_logs
    VALIDATE CONSTRAINT audit_logs_tenant_id_fkey;
