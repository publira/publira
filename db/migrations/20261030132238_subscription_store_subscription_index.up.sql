-- INDEX: subscriptions_tenant_provider_store_subscription_id_key
-- What makes a store subscription one row, however many times the app
-- confirms it: a confirmation of one already recorded updates that row.
--
-- CONCURRENTLY, so building it does not block the subscriptions Stripe's
-- webhooks keep writing, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY subscriptions_tenant_provider_store_subscription_id_key ON subscriptions USING btree (tenant_id, provider, store_subscription_id);
