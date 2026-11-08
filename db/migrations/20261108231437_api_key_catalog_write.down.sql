-- Take the write scope and the key as an audit actor away again.
--
-- An entry filed under a key and a key that holds the write scope have nothing
-- the earlier schema can hold them as, so the rollback refuses rather than
-- deleting the audit rows or the keys. Export those entries and revoke or
-- rescope those keys first.
DO $$
DECLARE
    key_entries bigint;
    writing_keys bigint;
BEGIN
    SELECT count(*) INTO key_entries FROM audit_logs WHERE actor_api_key_id IS NOT NULL;
    IF key_entries > 0 THEN
        RAISE EXCEPTION
            'cannot drop audit_logs.actor_api_key_id: % entry/entries name an API key',
            key_entries;
    END IF;
    SELECT count(*) INTO writing_keys FROM tenant_api_keys WHERE 'catalog:write' = ANY (scopes);
    IF writing_keys > 0 THEN
        RAISE EXCEPTION
            'cannot drop the catalog:write scope: % API key(s) hold it',
            writing_keys;
    END IF;
END
$$;

ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_actor_api_key_id_check,
    DROP CONSTRAINT audit_logs_actor_user_id_check,
    DROP CONSTRAINT audit_logs_tenant_actor_api_key_id_fkey;

ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_check CHECK ((num_nonnulls(actor_user_id, actor_public_id) = CASE WHEN ((actor_role)::text = 'system'::text) THEN 0 ELSE 1 END));

ALTER TABLE ONLY audit_logs
    DROP COLUMN actor_api_key_id;

ALTER TABLE ONLY tenant_api_keys
    DROP CONSTRAINT tenant_api_keys_tenant_id_id_key;

ALTER TABLE ONLY tenant_api_keys
    DROP CONSTRAINT tenant_api_keys_scopes_check,
    ADD CONSTRAINT tenant_api_keys_scopes_check CHECK (((cardinality(scopes) >= 1) AND (scopes <@ ARRAY['catalog:read'::text, 'purchases:read'::text])));
