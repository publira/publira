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
-- are that tenant's alone. search_path is fixed so the body cannot be pointed
-- at another schema's tables.
CREATE OR REPLACE FUNCTION audit_logs_keep_deleted_actor() RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
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
