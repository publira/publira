-- INDEX: idx_purchases_provider_payment_id
-- The lookup a refund arrives by: a refund notification names the provider's
-- payment, and the purchase it reverses is found by that alone. Unique because
-- one checkout has one payment behind it, so a second purchase claiming the
-- same one would be a duplicate entitlement for one payment.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY idx_purchases_provider_payment_id ON purchases USING btree (provider, provider_payment_id);
