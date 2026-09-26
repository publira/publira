-- CONSTRAINT: purchases purchases_provider_checkout_id_key
-- The index the previous migrations built concurrently takes over from the
-- constraint and the index that keyed a purchase by the checkout or the
-- payment id alone. Attaching an index that already exists is a change to the
-- catalog only, so the lock this takes is brief.
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_provider_checkout_id_key UNIQUE USING INDEX purchases_provider_checkout_id_key;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_stripe_checkout_session_id_key;

DROP INDEX idx_purchases_stripe_payment_intent_id;
