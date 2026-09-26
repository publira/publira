CREATE UNIQUE INDEX idx_purchases_stripe_payment_intent_id ON purchases USING btree (provider_payment_id);

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_stripe_checkout_session_id_key UNIQUE (provider_checkout_id);

-- Detaching the constraint drops its index along with it, and the previous
-- migration's down expects to find that index still there.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_provider_checkout_id_key;

CREATE UNIQUE INDEX purchases_provider_checkout_id_key ON purchases USING btree (provider, provider_checkout_id);
