-- Validates the constraints the previous migration added NOT VALID. It is a
-- file of its own because golang-migrate runs one file as one transaction: on
-- its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads
-- and writes go on while it scans the table.
ALTER TABLE ONLY audit_logs
    VALIDATE CONSTRAINT audit_logs_tenant_actor_api_key_id_fkey;

ALTER TABLE ONLY audit_logs
    VALIDATE CONSTRAINT audit_logs_actor_user_id_check;

ALTER TABLE ONLY audit_logs
    VALIDATE CONSTRAINT audit_logs_actor_api_key_id_check;
