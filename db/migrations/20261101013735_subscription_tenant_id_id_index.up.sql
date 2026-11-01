-- INDEX: subscriptions_tenant_id_id_key
-- The target of a reference that names a subscription with its tenant, which
-- the next migration attaches as a constraint for the payments of a
-- subscription to point at.
--
-- CONCURRENTLY, so building it does not block the subscriptions Stripe's
-- webhooks keep writing, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY subscriptions_tenant_id_id_key ON subscriptions USING btree (tenant_id, id);
