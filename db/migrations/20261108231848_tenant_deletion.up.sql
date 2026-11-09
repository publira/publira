-- Lets an operator delete a suspended tenant: the request marks the row, and
-- the worker erases what the install keeps for the tenant and deletes the row
-- last.
--
-- The mark is a column of its own rather than a third value of status. A
-- tenant marked for deletion keeps status 'suspended', which every release
-- already refuses, so the previous release's processes, still serving during
-- an upgrade, refuse it too instead of reading a status they do not know as a
-- tenant to serve.

-- COLUMN: tenants deletion_requested_at
-- When an operator asked for the tenant to be deleted, NULL for a tenant no
-- one has. Only a suspended tenant may carry it, so a tenant being erased can
-- be neither resumed nor served, by this release or the one before.
ALTER TABLE ONLY tenants
    ADD COLUMN deletion_requested_at timestamp with time zone,
    ADD CONSTRAINT tenants_deletion_requires_suspension_check CHECK (((deletion_requested_at IS NULL) OR ((status)::text = 'suspended'::text)));

-- COLUMNS: platform_audit_logs tenant_*
-- What an entry keeps of the tenant it is about once the tenant row is gone.
-- Every other entry reads the tenant through its row, so only the entries of a
-- tenant's deletion fill them.
ALTER TABLE ONLY platform_audit_logs
    ADD COLUMN tenant_public_id text,
    ADD COLUMN tenant_name text,
    ADD COLUMN tenant_domain text,
    ADD COLUMN tenant_admin_domain text;

-- FUNCTION: royalty_statements_refuse_changes
-- A closed statement is what a publisher pays from, so no role may rewrite or
-- remove one, the platform role that bypasses RLS included. Two changes are
-- let through. One is a referential action — a deleted creator nulling its
-- reference, a deleted tenant taking its statements along — which runs inside
-- the foreign key's own trigger and so arrives nested one level deeper. The
-- other is the delete of a statement of a tenant marked for deletion, which
-- the worker makes in batches before it deletes the tenant row, so the row's
-- own delete does not have to take every statement with it in one statement.
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
    IF TG_OP = 'DELETE' AND EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = OLD.tenant_id
            AND t.deletion_requested_at IS NOT NULL
    ) THEN
        RETURN OLD;
    END IF;
    RAISE EXCEPTION 'a closed royalty statement cannot be changed'
        USING ERRCODE = 'restrict_violation';
END;
$$;

-- FUNCTION: erase_tenant_audit_logs
-- Deletes up to batch_size entries of a tenant's audit log, for the worker's
-- erasure of a tenant marked for deletion, and answers how many it deleted.
-- The log is append-only for every role Publira's processes connect as, and
-- the tenant's log is the tenant's record, which goes with the tenant: this
-- is the one delete that reaches it, and it refuses a tenant no operator
-- asked to delete.
--
-- SECURITY DEFINER because no such role holds DELETE on audit_logs: it runs as
-- the role that applied the migrations, which owns the table and is outside
-- its row-level security. The tenant comes from the argument and is checked
-- against the mark, so the body deletes nothing of a tenant still kept. The
-- baseline seed takes EXECUTE from PUBLIC and grants it to the maintenance
-- role alone, and the search path ends with pg_temp, with every table named
-- with its schema, so a temporary table of the same name cannot take the
-- delete.
CREATE FUNCTION erase_tenant_audit_logs(target_tenant_id uuid, batch_size integer) RETURNS bigint
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $$
DECLARE
    erased bigint;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.tenants t
        WHERE t.id = target_tenant_id
            AND t.deletion_requested_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'tenant % is not marked for deletion', target_tenant_id
            USING ERRCODE = 'restrict_violation';
    END IF;
    DELETE FROM public.audit_logs
    WHERE ctid = ANY (ARRAY(
        SELECT a.ctid
        FROM public.audit_logs a
        WHERE a.tenant_id = target_tenant_id
        LIMIT batch_size
    ));
    GET DIAGNOSTICS erased = ROW_COUNT;
    RETURN erased;
END;
$$;
