-- INDEX: idx_subscription_payments_tenant_dispute_lost
-- What royalty_uncarried_subscription_refunds starts from for a payment whose
-- dispute was lost and that no refund was recorded on.
--
-- CONCURRENTLY, so building it does not block the payments a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_subscription_payments_tenant_dispute_lost ON subscription_payments USING btree (tenant_id) WHERE (dispute_lost_at IS NOT NULL);
