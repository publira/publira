-- INDEX: idx_purchases_tenant_refunded
-- What royalty_uncarried_refunds starts from: a tenant's purchases with a
-- refund on them, a small part of everything it has sold, which every royalty
-- close and preview reads.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_purchases_tenant_refunded ON purchases USING btree (tenant_id) WHERE (refunded_amount IS NOT NULL);
