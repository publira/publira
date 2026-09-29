-- A validated constraint cannot be marked NOT VALID again, so it is recreated
-- as the provider migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_provider_check,
    ADD CONSTRAINT purchases_provider_check CHECK ((((provider IS NULL) = (provider_checkout_id IS NULL)) AND ((provider_payment_id IS NULL) OR (provider IS NOT NULL)) AND ((provider IS NULL) OR (store IS NULL)))) NOT VALID;
