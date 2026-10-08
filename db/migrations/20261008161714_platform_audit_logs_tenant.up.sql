-- The tenant a platform audit entry is about, kept on the entry itself.

-- COLUMN: platform_audit_logs tenant_id
-- Written with the entry rather than derived from its target on every read: a
-- reader the platform deletes takes its users row with it, and an entry that
-- found its tenant through that row would drop out of the tenant's log, the
-- user_deleted entry itself included.
--
-- No foreign key, like target_id: the log outlives what it names, and a key
-- would either refuse to delete a tenant that has entries or erase the record
-- of what was done to it. NULL is an entry about no tenant, such as a
-- platform setting or an operator.
ALTER TABLE platform_audit_logs
    ADD COLUMN tenant_id uuid;

-- FUNCTION: platform_audit_log_target_tenant
-- The tenant an entry's target names while the target still exists: the
-- tenant itself, the tenant of an admin invitation, or the tenant of a user.
-- NULL for any other target, and for one that is already gone.
--
-- SECURITY INVOKER: the roles that write platform entries already read these
-- tables, so the lookup needs no rights of its own.
CREATE FUNCTION platform_audit_log_target_tenant(target_type text, target_id text) RETURNS uuid
    LANGUAGE sql
    STABLE
    SECURITY INVOKER
    AS $$
    SELECT CASE target_type
        WHEN 'tenant' THEN (SELECT t.id FROM tenants t WHERE t.id::text = target_id)
        WHEN 'tenant_admin_invitation' THEN (SELECT i.tenant_id FROM tenant_admin_invitations i WHERE i.id::text = target_id)
        WHEN 'user' THEN (SELECT u.tenant_id FROM users u WHERE u.id::text = target_id)
    END;
$$;

-- FUNCTION: platform_audit_logs_fill_tenant
-- Gives an entry written without its tenant the one its target names.
--
-- The server sets tenant_id itself, and must, because it records user_deleted
-- after the users row is gone. This covers the writers that do not: the
-- processes of the previous release keep serving between db migrate and their
-- restart, and the entries they write in that window would otherwise stay out
-- of the tenant's log for good, after the backfill below has already run.
CREATE FUNCTION platform_audit_logs_fill_tenant() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY INVOKER
    AS $$
BEGIN
    NEW.tenant_id := platform_audit_log_target_tenant(NEW.target_type, NEW.target_id);
    RETURN NEW;
END;
$$;

-- TRIGGER: platform_audit_logs platform_audit_logs_fill_tenant
CREATE TRIGGER platform_audit_logs_fill_tenant
    BEFORE INSERT ON platform_audit_logs
    FOR EACH ROW
    WHEN (NEW.tenant_id IS NULL AND NEW.target_type IN ('tenant', 'tenant_admin_invitation', 'user'))
    EXECUTE FUNCTION platform_audit_logs_fill_tenant();

-- The entries already stored take the tenant their target still names. One
-- whose target is already gone stays NULL: nothing left says which tenant it
-- was for.
UPDATE platform_audit_logs
SET tenant_id = platform_audit_log_target_tenant(target_type, target_id)
WHERE target_type IN ('tenant', 'tenant_admin_invitation', 'user');
