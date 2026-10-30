-- A validated constraint cannot be marked NOT VALID again, so both are
-- recreated as the store subscription migration left them.
ALTER TABLE ONLY subscriptions
    DROP CONSTRAINT subscriptions_store_subscription_id_check,
    ADD CONSTRAINT subscriptions_store_subscription_id_check CHECK (((char_length(store_subscription_id) >= 1) AND (char_length(store_product_id) >= 1))) NOT VALID;

ALTER TABLE ONLY subscriptions
    DROP CONSTRAINT subscriptions_provider_check,
    ADD CONSTRAINT subscriptions_provider_check CHECK (((provider = ANY (ARRAY['stripe'::text, 'app_store'::text, 'google_play'::text])) AND ((provider = 'stripe'::text) = (stripe_customer_id IS NOT NULL)) AND ((provider = 'stripe'::text) = (stripe_subscription_id IS NOT NULL)) AND ((provider = 'stripe'::text) = (stripe_price_id IS NOT NULL)) AND ((provider = 'stripe'::text) = (store_subscription_id IS NULL)) AND ((provider = 'stripe'::text) = (store_product_id IS NULL)) AND ((NOT is_test) OR (provider <> 'stripe'::text)))) NOT VALID;
