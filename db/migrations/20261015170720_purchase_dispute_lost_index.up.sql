-- INDEX: idx_purchases_tenant_dispute_lost
-- The other half of what royalty_uncarried_refunds starts from, beside
-- idx_purchases_tenant_refunded: a tenant's purchases whose dispute was lost.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_purchases_tenant_dispute_lost ON purchases USING btree (tenant_id) WHERE (dispute_lost_at IS NOT NULL);
