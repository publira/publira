-- A key that writes the catalog, and the audit entries it is the actor of.
--
-- The constraints on audit_logs are added NOT VALID so this file takes its
-- ACCESS EXCLUSIVE lock without scanning the table; the next migration
-- validates them under a lock that lets reads and writes continue.

-- CONSTRAINT: tenant_api_keys tenant_api_keys_scopes_check
-- 'catalog:write' creates and updates series and episodes, their pages, their
-- eye-catches, their credits, and their publication schedule. The table holds
-- a handful of keys per tenant, so the constraint is validated here.
ALTER TABLE ONLY tenant_api_keys
    DROP CONSTRAINT tenant_api_keys_scopes_check,
    ADD CONSTRAINT tenant_api_keys_scopes_check CHECK (((cardinality(scopes) >= 1) AND (scopes <@ ARRAY['catalog:read'::text, 'catalog:write'::text, 'purchases:read'::text])));

-- CONSTRAINT: tenant_api_keys tenant_api_keys_tenant_id_id_key
-- What the audit entries' composite foreign key references, so an entry names
-- a key of its own tenant.
ALTER TABLE ONLY tenant_api_keys
    ADD CONSTRAINT tenant_api_keys_tenant_id_id_key UNIQUE (tenant_id, id);

-- COLUMN: audit_logs actor_api_key_id
-- The tenant's API key a write was made with, filed under the 'api_key' role.
-- A key is revoked rather than deleted, so the entry reads the key's name
-- through it for as long as the entry exists.
ALTER TABLE ONLY audit_logs
    ADD COLUMN actor_api_key_id uuid;

-- FK CONSTRAINT: audit_logs audit_logs_tenant_actor_api_key_id_fkey
ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_tenant_actor_api_key_id_fkey FOREIGN KEY (tenant_id, actor_api_key_id) REFERENCES tenant_api_keys(tenant_id, id) NOT VALID;

-- CONSTRAINT: audit_logs audit_logs_actor_user_id_check
-- An entry names its actor exactly one way: a member by the account while it
-- exists or by what was kept of it once it is deleted, a key by the key, and
-- the platform's own 'system' entries by none of them. The previous release
-- writes no key, so every entry it writes still holds.
ALTER TABLE ONLY audit_logs
    DROP CONSTRAINT audit_logs_actor_user_id_check,
    ADD CONSTRAINT audit_logs_actor_user_id_check CHECK ((num_nonnulls(actor_user_id, actor_public_id, actor_api_key_id) = CASE WHEN ((actor_role)::text = 'system'::text) THEN 0 ELSE 1 END)) NOT VALID;

-- CONSTRAINT: audit_logs audit_logs_actor_api_key_id_check
-- A key is the actor of an entry exactly when the entry is filed under
-- 'api_key', so a member's role is never read as a key's or the other way.
ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_actor_api_key_id_check CHECK (((actor_api_key_id IS NOT NULL) = ((actor_role)::text = 'api_key'::text))) NOT VALID;
