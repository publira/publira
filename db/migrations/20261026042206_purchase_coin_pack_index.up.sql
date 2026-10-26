-- INDEX: idx_purchases_tenant_coin_pack_id
-- Which purchases bought a pack, and the composite foreign key to
-- tenant_coin_packs. Partial, since almost every purchase is of an episode.
--
-- CONCURRENTLY, so building it does not block the purchases a storefront keeps
-- writing, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_purchases_tenant_coin_pack_id ON purchases USING btree (tenant_id, coin_pack_id) WHERE (coin_pack_id IS NOT NULL);
