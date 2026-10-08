-- INDEX: idx_platform_audit_logs_tenant_created_at
-- Platform ListAuditLogs filtered by a tenant, in the cursor's (created_at, id)
-- order, read forward and in reverse alike. Concurrently, and so in a file of
-- its own, because the server writes to this table while it is built.
CREATE INDEX CONCURRENTLY idx_platform_audit_logs_tenant_created_at ON platform_audit_logs USING btree (tenant_id, created_at DESC, id DESC);
