-- A refund that arrived before the purchase it reverses.
--
-- Stripe does not guarantee the order its events are delivered in, and the
-- purchase is created by a different event than the refund: when
-- checkout.session.completed is still being retried after a failed delivery,
-- the tenant can refund the payment it fulfilled nothing for, and that refund
-- reaches us first. Acknowledging it and forgetting it would let the retried
-- Checkout event go on to create a purchase that opens the episode for money
-- the reader has back. This table is where such a refund waits.

-- TABLE: unapplied_stripe_refunds
-- One row per payment intent that has been refunded and has no purchase here
-- yet. The row is deleted once the refund has been written onto the purchase,
-- so the table holds only what is still outstanding.
CREATE TABLE unapplied_stripe_refunds (
    tenant_id uuid NOT NULL,
    stripe_payment_intent_id text NOT NULL,
    -- What Stripe reported refunded, in the same minor unit as
    -- purchases.price_at_purchase. NULL is the event that reported no
    -- comparable amount, which is applied as a refund of the whole price.
    refunded_amount integer,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT unapplied_stripe_refunds_refunded_amount_check CHECK ((refunded_amount >= 0))
);

-- CONSTRAINT: unapplied_stripe_refunds unapplied_stripe_refunds_pkey
-- The payment intent is the whole identity: a repeated delivery of the same
-- refund, and a second refund against the same charge, both land on this row.
ALTER TABLE ONLY unapplied_stripe_refunds
    ADD CONSTRAINT unapplied_stripe_refunds_pkey PRIMARY KEY (tenant_id, stripe_payment_intent_id);

-- FK CONSTRAINT: unapplied_stripe_refunds fk_unapplied_stripe_refunds_tenant_id
ALTER TABLE ONLY unapplied_stripe_refunds
    ADD CONSTRAINT fk_unapplied_stripe_refunds_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: unapplied_stripe_refunds
ALTER TABLE unapplied_stripe_refunds ENABLE ROW LEVEL SECURITY;

-- POLICY: unapplied_stripe_refunds unapplied_stripe_refunds_tenant_isolation
-- The same isolation purchases carries. A row names one tenant's payment
-- intent and the money behind it, and the webhook that writes it runs on the
-- storefront's own connection.
CREATE POLICY unapplied_stripe_refunds_tenant_isolation ON unapplied_stripe_refunds
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
