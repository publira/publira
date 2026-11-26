-- INDEX: idx_payment_checkouts_tenant_provider_payment_id
-- The lookup an unsigned notification of a payment is held to before the
-- provider's API is asked about it: a provider whose checkouts run in the
-- browser names the payment alone, and the checkout it completed is found by
-- the payment kept beside it.
--
-- CONCURRENTLY, so building it does not block the checkouts a storefront
-- keeps writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_payment_checkouts_tenant_provider_payment_id ON payment_checkouts USING btree (tenant_id, provider, payment_id) WHERE (payment_id IS NOT NULL);
