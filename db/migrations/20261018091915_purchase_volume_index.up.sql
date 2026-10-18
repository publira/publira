-- INDEX: idx_purchases_tenant_volume_id
-- Which purchases bought a volume: what keeps an episode in a volume someone
-- has bought, and the composite foreign key to volumes. Partial, since almost
-- every purchase is of an episode.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_purchases_tenant_volume_id ON purchases USING btree (tenant_id, volume_id) WHERE (volume_id IS NOT NULL);
