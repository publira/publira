-- Emptying provider again breaks purchases_provider_check for every row it
-- touches, and an update is checked even against a NOT VALID constraint, so the
-- constraint is lifted around the update and restored as the previous
-- migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_provider_check;

UPDATE purchases
SET provider = NULL
WHERE provider = 'stripe';

ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_provider_check CHECK ((((provider IS NULL) = (provider_checkout_id IS NULL)) AND ((provider_payment_id IS NULL) OR (provider IS NOT NULL)) AND ((provider IS NULL) OR (store IS NULL)))) NOT VALID;
