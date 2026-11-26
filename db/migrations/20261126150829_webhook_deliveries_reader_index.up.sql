-- INDEX: webhook_deliveries idx_webhook_deliveries_tenant_reader_id
-- What the cascade from a deleted account finds its deliveries by, so deleting
-- an account does not scan every delivery of the tenant.
--
-- CONCURRENTLY, so building it does not block the deliveries the worker keeps
-- recording, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_webhook_deliveries_tenant_reader_id ON webhook_deliveries USING btree (tenant_id, reader_id) WHERE (reader_id IS NOT NULL);
