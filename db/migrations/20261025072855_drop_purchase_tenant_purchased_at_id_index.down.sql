CREATE INDEX CONCURRENTLY idx_purchases_tenant_purchased_at_id ON purchases USING btree (tenant_id, purchased_at DESC, id DESC) INCLUDE (episode_id);
