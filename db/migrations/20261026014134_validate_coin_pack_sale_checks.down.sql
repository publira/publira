-- A validated constraint cannot be marked NOT VALID again, so each is recreated
-- as the previous migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_item_check,
    ADD CONSTRAINT purchases_item_check CHECK (((num_nonnulls(episode_id, volume_id, series_bundle_id, coin_pack_id) = 1) AND ((episode_id IS NOT NULL) OR ((kind = 'purchase'::text) AND ((store IS NULL) OR (coin_pack_id IS NOT NULL)))) AND ((coin_pack_id IS NULL) OR (expires_at IS NULL)))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_coin_pack_id_fkey,
    ADD CONSTRAINT purchases_tenant_coin_pack_id_fkey FOREIGN KEY (tenant_id, coin_pack_id) REFERENCES tenant_coin_packs(tenant_id, id) NOT VALID;

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_item_check,
    ADD CONSTRAINT store_purchase_intents_item_check CHECK ((((episode_id IS NULL) <> (coin_pack_id IS NULL)) AND ((coin_pack_id IS NULL) = (coins IS NULL)) AND ((coin_pack_id IS NULL) = (bonus_coins IS NULL)) AND ((coin_pack_id IS NULL) = (coin_expiry_days IS NULL)) AND ((coin_pack_id IS NULL) OR ((reading_period_hours IS NULL) AND (coins >= 1) AND (bonus_coins >= 0) AND (bonus_coins <= (2147483647 - coins)) AND (coin_expiry_days >= 1) AND (coin_expiry_days <= 36500))))) NOT VALID;

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_tenant_coin_pack_id_fkey,
    ADD CONSTRAINT store_purchase_intents_tenant_coin_pack_id_fkey FOREIGN KEY (tenant_id, coin_pack_id) REFERENCES tenant_coin_packs(tenant_id, id) ON DELETE CASCADE NOT VALID;
