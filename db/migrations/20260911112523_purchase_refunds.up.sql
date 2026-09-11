-- What a Stripe refund leaves behind on the purchase it reverses, so a
-- refunded sale is distinguishable from a paid one before any royalty
-- statement is computed from this table.

-- COLUMN: purchases stripe_payment_intent_id
-- A refund event names a charge and its payment intent, never the Checkout
-- Session the purchase stores. Recording the payment intent when the purchase
-- is created is what closes that gap; the alternative, asking Stripe which
-- session a payment intent belongs to, would put a synchronous call to another
-- service inside the webhook path.
--
-- Nullable and unique for the same reasons stripe_checkout_session_id is:
-- admin-issued grants pay through no provider and leave it empty, while a
-- session that did pay has exactly one payment intent behind it.
ALTER TABLE purchases
    ADD COLUMN stripe_payment_intent_id text;

-- CONSTRAINT: purchases purchases_stripe_payment_intent_id_key
-- Its index is also the lookup a refund arrives by.
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_stripe_payment_intent_id_key UNIQUE (stripe_payment_intent_id);

-- COLUMN: purchases refunded_amount
-- The cumulative amount Stripe has refunded against the purchase, in the same
-- minor unit as price_at_purchase. NULL means no refund has arrived, which is
-- a different fact from a refund of zero.
ALTER TABLE purchases
    ADD COLUMN refunded_amount integer;

-- CONSTRAINT: purchases purchases_refunded_amount_check
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_refunded_amount_check CHECK (refunded_amount >= 0);

-- COLUMN: purchases refunded_at
-- Set once the refunded amount reaches the price paid, and left NULL while it
-- has not. The entitlement predicate reads this column and nothing else, so a
-- partial refund keeps the reader's access — they still paid for part of what
-- they bought — and a full one takes it away.
ALTER TABLE purchases
    ADD COLUMN refunded_at timestamp with time zone;
