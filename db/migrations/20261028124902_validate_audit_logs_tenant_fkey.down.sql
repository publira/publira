-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the previous migration left it.
ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_tenant_id_fkey,
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT NOT VALID;
