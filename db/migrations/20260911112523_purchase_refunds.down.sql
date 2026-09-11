ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_refunded_amount_check;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_stripe_payment_intent_id_key;

ALTER TABLE purchases
    DROP COLUMN refunded_at;

ALTER TABLE purchases
    DROP COLUMN refunded_amount;

ALTER TABLE purchases
    DROP COLUMN stripe_payment_intent_id;
