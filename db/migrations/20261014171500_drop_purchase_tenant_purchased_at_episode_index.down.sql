CREATE INDEX CONCURRENTLY idx_purchases_tenant_purchased_at_episode ON purchases USING btree (tenant_id, purchased_at DESC, episode_id);
