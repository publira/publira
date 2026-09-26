-- A purchase and a held refund name the payment provider that took the money
-- and that provider's own checkout and payment ids, rather than carrying
-- columns named after Stripe's Checkout Session and Payment Intent. Another
-- provider has neither, and its ids have to be just as idempotent and just as
-- refundable.
--
-- The Stripe columns are renamed rather than copied, so the ids already stored
-- stay where they are. The constraint and the index that key them by the id
-- alone stay too, until the next migrations have built their replacements
-- concurrently: dropping them here would leave a window in which a redelivered
-- notification could create a second purchase.

-- COLUMN: purchases provider_checkout_id
-- The provider's id of the checkout the purchase was created from. A purchase
-- is created once per checkout however many times the notification that
-- confirms it is delivered.
ALTER TABLE purchases
    RENAME COLUMN stripe_checkout_session_id TO provider_checkout_id;

-- COLUMN: purchases provider_payment_id
-- The provider's id of the payment its refunds name. A refund notification
-- finds its purchase by this and never by the checkout.
ALTER TABLE purchases
    RENAME COLUMN stripe_payment_intent_id TO provider_payment_id;

-- COLUMN: purchases provider
-- The payment provider the reader paid through, as its declaration names it
-- in stored settings and in the webhook route. NULL for an admin-issued grant
-- and a store purchase, which pay through no provider.
ALTER TABLE purchases
    ADD COLUMN provider text;

-- Every purchase that names a checkout was created from a Stripe one, which
-- until now was the only provider there was.
UPDATE purchases
SET provider = 'stripe'
WHERE provider_checkout_id IS NOT NULL;

-- CONSTRAINT: purchases purchases_provider_check
-- A provider purchase names its checkout, only a provider purchase names a
-- payment, and a store purchase is never a provider one.
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_provider_check CHECK ((((provider IS NULL) = (provider_checkout_id IS NULL)) AND ((provider_payment_id IS NULL) OR (provider IS NOT NULL)) AND ((provider IS NULL) OR (store IS NULL))));

-- TABLE: unapplied_refunds
-- A refund that arrived before the purchase it reverses, kept until the
-- notification that creates the purchase applies it.
ALTER TABLE unapplied_stripe_refunds
    RENAME TO unapplied_refunds;

ALTER TABLE unapplied_refunds
    RENAME COLUMN stripe_payment_intent_id TO provider_payment_id;

-- COLUMN: unapplied_refunds provider
-- The provider whose payment provider_payment_id names. Every row held so far
-- is a Stripe refund; the default only fills those in and is dropped at once,
-- so a new row always says which provider it came from.
ALTER TABLE unapplied_refunds
    ADD COLUMN provider text DEFAULT 'stripe' NOT NULL;

ALTER TABLE unapplied_refunds
    ALTER COLUMN provider DROP DEFAULT;

-- CONSTRAINT: unapplied_refunds unapplied_refunds_pkey
-- The provider's payment is the whole identity within a tenant: a repeated
-- delivery of the same refund, and a second refund against the same payment,
-- both land on this row.
ALTER TABLE ONLY unapplied_refunds
    DROP CONSTRAINT unapplied_stripe_refunds_pkey;

ALTER TABLE ONLY unapplied_refunds
    ADD CONSTRAINT unapplied_refunds_pkey PRIMARY KEY (tenant_id, provider, provider_payment_id);

ALTER TABLE unapplied_refunds
    RENAME CONSTRAINT unapplied_stripe_refunds_refunded_amount_check TO unapplied_refunds_refunded_amount_check;

ALTER TABLE unapplied_refunds
    RENAME CONSTRAINT fk_unapplied_stripe_refunds_tenant_id TO fk_unapplied_refunds_tenant_id;

ALTER POLICY unapplied_stripe_refunds_tenant_isolation ON unapplied_refunds
    RENAME TO unapplied_refunds_tenant_isolation;
