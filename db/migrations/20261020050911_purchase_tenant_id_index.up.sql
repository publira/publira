-- INDEX: purchases_tenant_id_id_key
-- What lets a row name a purchase together with its tenant, as every
-- reference to a tenant-scoped row does. The next migration attaches it as
-- the table's unique constraint.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY purchases_tenant_id_id_key ON purchases USING btree (tenant_id, id);
