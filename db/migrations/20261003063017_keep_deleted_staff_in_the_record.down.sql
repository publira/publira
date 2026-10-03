-- Hold a staff account back again while the tenant's record names it.
--
-- An entry whose actor was deleted has no account left to point at, so the
-- rollback refuses rather than deleting the audit rows the up exists to keep.
-- Export those entries first.
DO $$
DECLARE
    deleted_actors bigint;
BEGIN
    SELECT count(*) INTO deleted_actors FROM audit_logs WHERE actor_public_id IS NOT NULL;
    IF deleted_actors > 0 THEN
        RAISE EXCEPTION
            'cannot drop audit_logs.actor_public_id: % entry/entries name a deleted account',
            deleted_actors;
    END IF;
END
$$;

ALTER TABLE ONLY page_versions
    DROP CONSTRAINT page_versions_tenant_author_user_id_fkey;

ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_tenant_author_user_id_fkey FOREIGN KEY (tenant_id, author_user_id) REFERENCES users(tenant_id, id);

DROP TRIGGER users_keep_deleted_actor_in_audit_logs ON users;

DROP FUNCTION audit_logs_keep_deleted_actor();

ALTER TABLE audit_logs
    DROP CONSTRAINT audit_logs_actor_name_check;

ALTER TABLE audit_logs
    DROP CONSTRAINT audit_logs_actor_user_id_check;

ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_check CHECK (((actor_user_id IS NULL) = ((actor_role)::text = 'system'::text)));

ALTER TABLE audit_logs
    DROP COLUMN actor_name,
    DROP COLUMN actor_public_id;
