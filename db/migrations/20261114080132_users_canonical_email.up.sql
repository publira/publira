-- INDEX: idx_users_canonical_email
-- The lookup behind the platform operator's search for every account that
-- holds an inbox, across tenants. idx_users_tenant_id_canonical_email cannot
-- answer it: its leading column is the tenant, and it leaves out the users
-- that belong to none.
--
-- CONCURRENTLY, so building it does not block the sign-ups readers keep
-- making, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_users_canonical_email ON users USING btree (canonical_email(email));
