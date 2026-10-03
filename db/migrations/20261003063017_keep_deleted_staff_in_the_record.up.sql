-- A staff account can be deleted while the tenant's record still names it.

-- COLUMN: audit_logs actor_public_id, actor_name
-- The account that acted, as it stood the moment it was deleted. While the
-- account exists both stay NULL and the console reads the actor through
-- actor_user_id, so a member who renames themselves is shown by their current
-- name; once it is gone these are what is left to show.
--
-- They are written when the account is deleted rather than with every entry:
-- copying the name into each row would freeze a name the console is meant to
-- keep current, and would need a backfill of every entry already written.
ALTER TABLE audit_logs
    ADD COLUMN actor_public_id character varying(12),
    ADD COLUMN actor_name text;

-- CONSTRAINT: audit_logs audit_logs_actor_user_id_check
-- An entry names its actor exactly one way: by the account while it exists, by
-- what was kept of it once it is deleted, and by neither for the platform's own
-- 'system' entries. A member's entry naming no one is still refused, so a
-- handler that forgot the actor cannot file a member's action as the
-- platform's.
ALTER TABLE audit_logs
    DROP CONSTRAINT audit_logs_actor_user_id_check;

ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_check CHECK ((num_nonnulls(actor_user_id, actor_public_id) = CASE WHEN ((actor_role)::text = 'system'::text) THEN 0 ELSE 1 END));

-- CONSTRAINT: audit_logs audit_logs_actor_name_check
-- The two halves of a deleted actor are kept together.
ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_actor_name_check CHECK (((actor_public_id IS NULL) = (actor_name IS NULL)));

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
-- SECURITY INVOKER, so the update stays inside the row-level security of the
-- connection deleting the account: the entries it touches are filed under the
-- deleted row's own tenant, which that connection already had to see to delete
-- it.
CREATE FUNCTION audit_logs_keep_deleted_actor() RETURNS trigger
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

-- TRIGGER: users users_keep_deleted_actor_in_audit_logs
CREATE TRIGGER users_keep_deleted_actor_in_audit_logs
    BEFORE DELETE ON users
    FOR EACH ROW
    EXECUTE FUNCTION audit_logs_keep_deleted_actor();

-- CONSTRAINT: page_versions page_versions_tenant_author_user_id_fkey
-- A page version outlives the account that wrote it and stops naming it. The
-- author was never shown anywhere, and who created or published a version
-- stays in the audit entry written when it happened, which keeps the actor
-- above.
--
-- Only author_user_id is nulled: tenant_id is NOT NULL and half of the key, so
-- the untold SET NULL would turn the delete into an error.
ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_tenant_author_user_id_fkey;

ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_tenant_author_user_id_fkey FOREIGN KEY (tenant_id, author_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (author_user_id);
