-- INDEX: idx_purchases_tenant_episode_id
-- Which purchases name an episode, and the composite foreign key to episodes,
-- which deleting an episode checks. Partial, since a purchase of a volume, a
-- bundle, or a coin pack names none.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_purchases_tenant_episode_id ON purchases USING btree (tenant_id, episode_id) WHERE (episode_id IS NOT NULL);
