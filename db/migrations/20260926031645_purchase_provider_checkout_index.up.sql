-- INDEX: purchases_provider_checkout_id_key
-- What makes a checkout one purchase, however many times the provider
-- delivers the notification that confirms it. The next migration attaches it
-- as the table's unique constraint.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY purchases_provider_checkout_id_key ON purchases USING btree (provider, provider_checkout_id);
