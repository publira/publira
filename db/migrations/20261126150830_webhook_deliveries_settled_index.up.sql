-- INDEX: webhook_deliveries idx_webhook_deliveries_settled_updated_at
-- The deliveries that are settled — delivered, or given up — by the instant
-- they were, which is when updated_at last moved. The purge reads the oldest
-- of them from here without scanning the deliveries still owed, and a resend
-- takes a delivery back out by making it pending.
--
-- CONCURRENTLY, so building it does not block the deliveries the worker keeps
-- recording, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_webhook_deliveries_settled_updated_at ON webhook_deliveries USING btree (updated_at) WHERE (status = ANY (ARRAY['delivered'::text, 'dead'::text]));
