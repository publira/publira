DROP FUNCTION erase_tenant_audit_logs(uuid, integer);

CREATE OR REPLACE FUNCTION royalty_statements_refuse_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a closed royalty statement cannot be changed'
        USING ERRCODE = 'restrict_violation';
END;
$$;

ALTER TABLE ONLY platform_audit_logs
    DROP COLUMN tenant_admin_domain,
    DROP COLUMN tenant_domain,
    DROP COLUMN tenant_name,
    DROP COLUMN tenant_public_id;

ALTER TABLE ONLY tenants
    DROP CONSTRAINT tenants_deletion_requires_suspension_check,
    DROP COLUMN deletion_requested_at;
