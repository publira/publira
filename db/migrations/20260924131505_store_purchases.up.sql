-- A purchase made with the App Store's or Google Play's in-app purchase, and
-- the intent the app opens before it shows the store's payment sheet.

-- COLUMN: purchases store
-- The store that charged the reader, NULL for a Stripe purchase and an
-- admin-issued grant.
ALTER TABLE purchases
    ADD COLUMN store text;

-- COLUMN: purchases store_transaction_id
-- The store's own ID of the charge: the App Store's transaction ID, or Google
-- Play's purchase token. Its uniqueness per tenant and store is enforced by an
-- index built concurrently in the next migration, since building it here
-- would hold an ACCESS EXCLUSIVE lock on the table for the length of the
-- build.
ALTER TABLE purchases
    ADD COLUMN store_transaction_id text;

-- COLUMN: purchases is_test
-- A transaction from the App Store sandbox or a Google Play license tester.
-- App Review buys that way against the production build, so such a purchase
-- has to open the episode, but no money reached the tenant: royalty
-- statements and the daily stats leave it out.
ALTER TABLE purchases
    ADD COLUMN is_test boolean DEFAULT false NOT NULL;

-- CONSTRAINT: purchases purchases_store_check
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_store_check CHECK ((store = ANY (ARRAY['app_store'::text, 'google_play'::text])));

-- CONSTRAINT: purchases purchases_store_transaction_check
-- A store purchase names its transaction, and only a store purchase can be a
-- test one.
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_store_transaction_check CHECK ((((store IS NULL) = (store_transaction_id IS NULL)) AND ((NOT is_test) OR (store IS NOT NULL))));

-- TABLE: store_purchase_intents
-- What the reader asked to buy before the store's payment sheet opened. The
-- app hands the intent ID to the store as the transaction's account token, so
-- the server, not the app, says which episode a verified transaction buys and
-- at what price.
CREATE TABLE store_purchase_intents (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    -- The episode's price when the intent was opened, which becomes the
    -- purchase's price_at_purchase.
    price integer NOT NULL,
    -- The store product the price maps to; a transaction for another product
    -- does not consume this intent.
    product_id text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Set when a verified transaction consumed the intent, which cannot be
    -- consumed again.
    consumed_at timestamp with time zone,
    CONSTRAINT store_purchase_intents_price_check CHECK ((price > 0)),
    CONSTRAINT store_purchase_intents_product_id_check CHECK ((char_length(product_id) > 0))
);

-- CONSTRAINT: store_purchase_intents store_purchase_intents_pkey
ALTER TABLE ONLY store_purchase_intents
    ADD CONSTRAINT store_purchase_intents_pkey PRIMARY KEY (id);

-- INDEX: idx_store_purchase_intents_open
-- One open intent per reader, episode, and product: asking again reuses it, so
-- a reader pressing Buy repeatedly adds no rows. The product is part of the
-- key because a price change mid-purchase must not repoint the intent a
-- transaction already in flight carries.
CREATE UNIQUE INDEX idx_store_purchase_intents_open ON store_purchase_intents USING btree (tenant_id, user_id, episode_id, product_id) WHERE (consumed_at IS NULL);

-- FK CONSTRAINT: store_purchase_intents store_purchase_intents_tenant_id_fkey
ALTER TABLE ONLY store_purchase_intents
    ADD CONSTRAINT store_purchase_intents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: store_purchase_intents store_purchase_intents_tenant_user_id_fkey
ALTER TABLE ONLY store_purchase_intents
    ADD CONSTRAINT store_purchase_intents_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: store_purchase_intents store_purchase_intents_tenant_episode_id_fkey
ALTER TABLE ONLY store_purchase_intents
    ADD CONSTRAINT store_purchase_intents_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: store_purchase_intents
ALTER TABLE store_purchase_intents ENABLE ROW LEVEL SECURITY;

-- POLICY: store_purchase_intents store_purchase_intents_tenant_isolation
CREATE POLICY store_purchase_intents_tenant_isolation ON store_purchase_intents USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
