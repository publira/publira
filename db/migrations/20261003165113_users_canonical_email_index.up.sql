-- INDEX: idx_users_tenant_id_canonical_email
-- The lookup that decides whether an account of the tenant already holds an
-- inbox. It is not unique: a tenant may already hold two addresses that differ
-- only by a tag, and those accounts are left as they are.
--
-- CONCURRENTLY, so building it does not block the sign-ups readers keep
-- making, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_users_tenant_id_canonical_email ON users USING btree (tenant_id, canonical_email(email)) WHERE (tenant_id IS NOT NULL);
