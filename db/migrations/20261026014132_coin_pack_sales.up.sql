-- COLUMN: purchases coin_pack_id
-- What a purchase bought is now exactly one of an episode, a volume, a series
-- bundle, and a pack of coins. A pack is bought once and for good, so it is
-- never rented and has no reading period, and unlike a volume or a bundle a
-- store sells it too, as the consumable coins_<pack public id>.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_item_check,
    ADD COLUMN coin_pack_id uuid,
    ADD CONSTRAINT purchases_item_check CHECK (((num_nonnulls(episode_id, volume_id, series_bundle_id, coin_pack_id) = 1) AND ((episode_id IS NOT NULL) OR ((kind = 'purchase'::text) AND ((store IS NULL) OR (coin_pack_id IS NOT NULL)))) AND ((coin_pack_id IS NULL) OR (expires_at IS NULL)))) NOT VALID,
    ADD CONSTRAINT purchases_tenant_coin_pack_id_fkey FOREIGN KEY (tenant_id, coin_pack_id) REFERENCES tenant_coin_packs(tenant_id, id) NOT VALID;

-- TABLE: coin_pack_purchases
-- The pack a purchase bought as it was when the checkout or the store's
-- payment sheet opened: the coins and the bonus coins the reader was shown,
-- which are what the purchase grants however the pack is edited before the
-- payment is confirmed. The price is the purchase's own price_at_purchase.
CREATE TABLE coin_pack_purchases (
    tenant_id uuid NOT NULL,
    purchase_id uuid NOT NULL,
    coins integer NOT NULL,
    bonus_coins integer NOT NULL,
    CONSTRAINT coin_pack_purchases_coins_check CHECK ((coins >= 1)),
    CONSTRAINT coin_pack_purchases_bonus_coins_check CHECK (((bonus_coins >= 0) AND (bonus_coins <= (2147483647 - coins))))
);

-- CONSTRAINT: coin_pack_purchases coin_pack_purchases_pkey
ALTER TABLE ONLY coin_pack_purchases
    ADD CONSTRAINT coin_pack_purchases_pkey PRIMARY KEY (tenant_id, purchase_id);

-- FK CONSTRAINT: coin_pack_purchases coin_pack_purchases_tenant_id_fkey
ALTER TABLE ONLY coin_pack_purchases
    ADD CONSTRAINT coin_pack_purchases_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: coin_pack_purchases coin_pack_purchases_tenant_purchase_id_fkey
ALTER TABLE ONLY coin_pack_purchases
    ADD CONSTRAINT coin_pack_purchases_tenant_purchase_id_fkey FOREIGN KEY (tenant_id, purchase_id) REFERENCES purchases(tenant_id, id);

-- ROW SECURITY: coin_pack_purchases
ALTER TABLE coin_pack_purchases ENABLE ROW LEVEL SECURITY;

-- POLICY: coin_pack_purchases coin_pack_purchases_tenant_isolation
CREATE POLICY coin_pack_purchases_tenant_isolation ON coin_pack_purchases USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: expired_coin_pack_checkouts
-- The checkout a reader last let expire on a pack, which the next checkout's
-- idempotency key names, as expired_checkouts is for an episode.
CREATE TABLE expired_coin_pack_checkouts (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    coin_pack_id uuid NOT NULL,
    provider text NOT NULL,
    provider_checkout_id text NOT NULL,
    expired_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: expired_coin_pack_checkouts expired_coin_pack_checkouts_pkey
ALTER TABLE ONLY expired_coin_pack_checkouts
    ADD CONSTRAINT expired_coin_pack_checkouts_pkey PRIMARY KEY (tenant_id, user_id, coin_pack_id);

-- FK CONSTRAINT: expired_coin_pack_checkouts expired_coin_pack_checkouts_tenant_id_fkey
ALTER TABLE ONLY expired_coin_pack_checkouts
    ADD CONSTRAINT expired_coin_pack_checkouts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: expired_coin_pack_checkouts expired_coin_pack_checkouts_tenant_user_id_fkey
ALTER TABLE ONLY expired_coin_pack_checkouts
    ADD CONSTRAINT expired_coin_pack_checkouts_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: expired_coin_pack_checkouts expired_coin_pack_checkouts_tenant_coin_pack_id_fkey
ALTER TABLE ONLY expired_coin_pack_checkouts
    ADD CONSTRAINT expired_coin_pack_checkouts_tenant_coin_pack_id_fkey FOREIGN KEY (tenant_id, coin_pack_id) REFERENCES tenant_coin_packs(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_expired_coin_pack_checkouts_tenant_coin_pack_id
CREATE INDEX idx_expired_coin_pack_checkouts_tenant_coin_pack_id ON expired_coin_pack_checkouts USING btree (tenant_id, coin_pack_id);

-- ROW SECURITY: expired_coin_pack_checkouts
ALTER TABLE expired_coin_pack_checkouts ENABLE ROW LEVEL SECURITY;

-- POLICY: expired_coin_pack_checkouts expired_coin_pack_checkouts_tenant_isolation
CREATE POLICY expired_coin_pack_checkouts_tenant_isolation ON expired_coin_pack_checkouts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: store_purchase_intents coin_pack_id
-- COLUMN: store_purchase_intents coins
-- COLUMN: store_purchase_intents bonus_coins
-- COLUMN: store_purchase_intents coin_expiry_days
-- An intent is now to buy an episode or a pack. One for a pack keeps the
-- pack's coins and bonus coins and the tenant's expiry_days as the payment
-- sheet opened on them, which are what the purchase grants, however long the
-- confirmation takes to arrive.
ALTER TABLE ONLY store_purchase_intents
    ALTER COLUMN episode_id DROP NOT NULL,
    ADD COLUMN coin_pack_id uuid,
    ADD COLUMN coins integer,
    ADD COLUMN bonus_coins integer,
    ADD COLUMN coin_expiry_days integer,
    ADD CONSTRAINT store_purchase_intents_item_check CHECK ((((episode_id IS NULL) <> (coin_pack_id IS NULL)) AND ((coin_pack_id IS NULL) = (coins IS NULL)) AND ((coin_pack_id IS NULL) = (bonus_coins IS NULL)) AND ((coin_pack_id IS NULL) = (coin_expiry_days IS NULL)) AND ((coin_pack_id IS NULL) OR ((reading_period_hours IS NULL) AND (coins >= 1) AND (bonus_coins >= 0) AND (bonus_coins <= (2147483647 - coins)) AND (coin_expiry_days >= 1) AND (coin_expiry_days <= 36500))))) NOT VALID,
    ADD CONSTRAINT store_purchase_intents_tenant_coin_pack_id_fkey FOREIGN KEY (tenant_id, coin_pack_id) REFERENCES tenant_coin_packs(tenant_id, id) ON DELETE CASCADE NOT VALID;

-- COLUMN: coin_grants revoked_at
-- When the grant was closed because the pack purchase that made it was
-- refunded or disputed, which takes back what it had left. A grant is closed
-- once: a refund reported again, or a dispute after a refund, finds it closed.
ALTER TABLE ONLY coin_grants
    ADD COLUMN revoked_at timestamp with time zone,
    ADD CONSTRAINT coin_grants_revoked_check CHECK (((revoked_at IS NULL) OR (remaining_coins = 0)));

-- CONSTRAINT: coin_transactions coin_transactions_kind_check
-- Two kinds account for the coins of a closed grant that had been spent. A
-- shortfall names the closed grant and the coins of it already spent, which
-- the reader now owes; it moves no coins. A shortfall settlement names a later
-- grant and the coins of it taken, as it was made, to pay what the reader
-- owed, so those coins were never theirs to spend.
ALTER TABLE ONLY coin_transactions
    DROP CONSTRAINT coin_transactions_kind_check,
    ADD CONSTRAINT coin_transactions_kind_check CHECK ((kind = ANY (ARRAY['grant'::text, 'spend'::text, 'revocation'::text, 'expiry'::text, 'shortfall'::text, 'shortfall_settlement'::text])));

-- INDEX: idx_coin_transactions_tenant_user_shortfall
-- What a reader owes, summed over their shortfalls and settlements alone each
-- time they are granted coins.
CREATE INDEX idx_coin_transactions_tenant_user_shortfall ON coin_transactions USING btree (tenant_id, user_id) WHERE (kind = ANY (ARRAY['shortfall'::text, 'shortfall_settlement'::text]));
