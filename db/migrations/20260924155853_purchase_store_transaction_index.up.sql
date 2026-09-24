-- INDEX: idx_purchases_tenant_store_transaction
-- The lookup a repeated confirmation arrives by, and what makes it one
-- purchase: a store transaction is sold once, however many times the app
-- confirms it.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY idx_purchases_tenant_store_transaction ON purchases USING btree (tenant_id, store, store_transaction_id);
