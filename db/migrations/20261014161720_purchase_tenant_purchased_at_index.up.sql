-- INDEX: idx_purchases_tenant_purchased_at_id
-- The order the console lists a tenant's purchases in, newest first, with the
-- id breaking a tie between two made at the same instant, so that a page
-- token names one row and the next page starts right after it.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_purchases_tenant_purchased_at_id ON purchases USING btree (tenant_id, purchased_at DESC, id DESC);
