-- A purchase of a pack names no episode, so it cannot outlive the column that
-- names its pack, and it is a sale the tenant was paid for. Rather than
-- deleting it, the rollback refuses to run while one exists, and while a
-- shortfall is on record, which the kinds the rollback takes away describe.
DO $$
BEGIN
    IF EXISTS (
            SELECT 1
            FROM purchases
            WHERE coin_pack_id IS NOT NULL
        ) THEN RAISE EXCEPTION 'purchases of coin packs exist; this migration cannot be rolled back without losing them';
    END IF;
    IF EXISTS (
            SELECT 1
            FROM coin_transactions
            WHERE kind IN ('shortfall', 'shortfall_settlement')
        ) THEN RAISE EXCEPTION 'coin shortfalls exist; this migration cannot be rolled back without losing them';
    END IF;
END $$;

DROP INDEX idx_coin_transactions_tenant_user_shortfall;

ALTER TABLE ONLY coin_transactions
    DROP CONSTRAINT coin_transactions_kind_check,
    ADD CONSTRAINT coin_transactions_kind_check CHECK ((kind = ANY (ARRAY['grant'::text, 'spend'::text, 'revocation'::text, 'expiry'::text])));

ALTER TABLE ONLY coin_grants
    DROP CONSTRAINT coin_grants_revoked_check,
    DROP COLUMN revoked_at;

-- An intent for a pack names no episode, so it goes before the column is
-- required again. Nothing was bought with it, and an open one is only a
-- payment sheet the reader has yet to pay.
DELETE FROM store_purchase_intents
WHERE coin_pack_id IS NOT NULL;

ALTER TABLE ONLY store_purchase_intents
    DROP CONSTRAINT store_purchase_intents_tenant_coin_pack_id_fkey,
    DROP CONSTRAINT store_purchase_intents_item_check,
    DROP COLUMN coin_expiry_days,
    DROP COLUMN bonus_coins,
    DROP COLUMN coins,
    DROP COLUMN coin_pack_id,
    ALTER COLUMN episode_id SET NOT NULL;

DROP TABLE expired_coin_pack_checkouts;

DROP TABLE coin_pack_purchases;

-- The CHECK goes back as the series bundles validation migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tenant_coin_pack_id_fkey,
    DROP CONSTRAINT purchases_item_check,
    DROP COLUMN coin_pack_id,
    ADD CONSTRAINT purchases_item_check CHECK (((num_nonnulls(episode_id, volume_id, series_bundle_id) = 1) AND ((episode_id IS NOT NULL) OR ((kind = 'purchase'::text) AND (store IS NULL)))));
