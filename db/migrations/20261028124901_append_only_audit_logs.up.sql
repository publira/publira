-- The audit logs are append-only for every role Publira's processes connect as:
-- the baseline seed takes UPDATE and DELETE on audit_logs and
-- platform_audit_logs away from them. This migration moves the one update the
-- record still needs out of their hands, and closes the one delete that could
-- still reach it.

-- FUNCTION: audit_logs_keep_deleted_actor
-- Moves the entries an account is the actor of from the account to what is kept
-- of it, just before the account goes, so the foreign key no longer holds the
-- account back.
--
-- It is a trigger rather than a statement in the handler because an account is
-- deleted from more than one place — the reader's own DeleteMe, an
-- administrator's DeleteReader, and the platform console — and a path that
-- forgot the statement would be refused by the foreign key with nothing to tell
-- the caller why.
--
-- SECURITY DEFINER because no role that deletes an account holds UPDATE on
-- audit_logs: the function runs as the role that applied the migrations, which
-- owns the table. An owner is outside the table's row-level security, so the
-- body takes nothing from the caller and confines itself instead: the tenant
-- and the account come from the deleted row, which the deleting connection's
-- own row-level security already had to let it see, and the entries it touches
-- are that tenant's alone.
--
-- Running as the owner, it must not run on anything but a deleted account.
-- A role may attach any trigger function it can execute to a table of its
-- own, so EXECUTE is taken from PUBLIC, and the body refuses to run for a
-- table other than users besides: a forged row of a temporary table would
-- otherwise rewrite any tenant's entries. And every role may create
-- temporary tables, which a search_path that leaves pg_temp out searches
-- first, so pg_temp goes last and the table the body updates is named with
-- its schema: a temporary audit_logs would otherwise take the update, and
-- its own triggers would run as the owner.
CREATE OR REPLACE FUNCTION audit_logs_keep_deleted_actor() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public, pg_temp
    AS $$
BEGIN
    IF TG_RELID <> 'public.users'::regclass THEN
        RAISE EXCEPTION 'audit_logs_keep_deleted_actor fires only for deletes from public.users';
    END IF;
    UPDATE public.audit_logs
    SET actor_user_id = NULL,
        actor_public_id = OLD.public_id,
        actor_name = OLD.name
    WHERE tenant_id = OLD.tenant_id
        AND actor_user_id = OLD.id;
    RETURN OLD;
END;
$$;

-- A trigger's function is checked for EXECUTE when the trigger is created,
-- not when it fires, so users_keep_deleted_actor_in_audit_logs keeps firing
-- for every role that deletes an account.
REVOKE EXECUTE ON FUNCTION audit_logs_keep_deleted_actor() FROM PUBLIC;

-- FK CONSTRAINT: audit_logs audit_logs_tenant_id_fkey
-- A tenant with history cannot be deleted, where the cascade used to take the
-- history with it. No query deletes a tenant, so this refuses only a delete
-- made by hand, which has to remove the entries itself first.
--
-- It is added NOT VALID: every entry already names a tenant, which the
-- constraint it replaces kept, and the next migration validates it in a
-- transaction of its own.
ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_tenant_id_fkey,
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT NOT VALID;
