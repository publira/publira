DROP TRIGGER platform_audit_logs_fill_tenant ON platform_audit_logs;

DROP FUNCTION platform_audit_logs_fill_tenant();

DROP FUNCTION platform_audit_log_target_tenant(text, text);

ALTER TABLE platform_audit_logs
    DROP COLUMN tenant_id;
