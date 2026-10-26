-- INDEX: idx_store_purchase_intents_open_coin_pack
-- One open intent per reader, pack, and product, as
-- idx_store_purchase_intents_open is per episode, whose key an intent for a
-- pack does not reach: its episode is NULL, and NULLs are distinct.
--
-- CONCURRENTLY, so building it does not block the intents the app keeps
-- opening, which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY idx_store_purchase_intents_open_coin_pack ON store_purchase_intents USING btree (tenant_id, user_id, coin_pack_id, product_id) WHERE ((consumed_at IS NULL) AND (coin_pack_id IS NOT NULL));
