ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_tenant_id_fkey,
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

GRANT EXECUTE ON FUNCTION audit_logs_keep_deleted_actor() TO PUBLIC;

CREATE OR REPLACE FUNCTION audit_logs_keep_deleted_actor() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    AS $$
BEGIN
    UPDATE audit_logs
    SET actor_user_id = NULL,
        actor_public_id = OLD.public_id,
        actor_name = OLD.name
    WHERE tenant_id = OLD.tenant_id
        AND actor_user_id = OLD.id;
    RETURN OLD;
END;
$$;
