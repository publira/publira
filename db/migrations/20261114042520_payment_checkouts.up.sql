-- The checkouts started through a payment provider that cannot carry a
-- checkout's purchase to the notification that confirms it, as one whose
-- payments take no metadata cannot. The server writes the purchase down here
-- before the checkout starts, under the id it gives the provider's checkout,
-- and reads it back when the provider reports the checkout paid or expired.
-- Reconciliation reads the payment of each of the checkouts of a period from
-- such a provider, which lists none of its payments itself.

-- TABLE: payment_checkouts
CREATE TABLE payment_checkouts (
    tenant_id uuid NOT NULL,
    provider character varying(32) NOT NULL,
    -- The id the server gave the provider's checkout, derived from the
    -- checkout's idempotency key, so a retried request names the same one.
    checkout_id text NOT NULL,
    -- What the checkout sells, as paymentprovider.Purchase encodes it. The
    -- encoding is the server's, so a field a later release adds is one an
    -- earlier release passes over, and one it lacks reads as zero.
    purchase jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    -- When a request last started the checkout. A retry names the same
    -- checkout, and the provider may make it only then, after a first attempt
    -- that never reached it, so the checkout can be paid from created_at up to
    -- the provider's checkout lifetime after this.
    last_started_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT payment_checkouts_purchase_object_check CHECK ((jsonb_typeof(purchase) = 'object'::text))
);

-- CONSTRAINT: payment_checkouts payment_checkouts_pkey
ALTER TABLE ONLY payment_checkouts
    ADD CONSTRAINT payment_checkouts_pkey PRIMARY KEY (tenant_id, provider, checkout_id);

-- FK CONSTRAINT: payment_checkouts payment_checkouts_tenant_id_fkey
ALTER TABLE ONLY payment_checkouts
    ADD CONSTRAINT payment_checkouts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_payment_checkouts_tenant_provider_last_started_at
-- Reconciliation lists the checkouts of a provider that could have been paid
-- in a period.
CREATE INDEX idx_payment_checkouts_tenant_provider_last_started_at ON payment_checkouts USING btree (tenant_id, provider, last_started_at);

-- ROW SECURITY: payment_checkouts
ALTER TABLE payment_checkouts ENABLE ROW LEVEL SECURITY;

-- POLICY: payment_checkouts payment_checkouts_tenant_isolation
CREATE POLICY payment_checkouts_tenant_isolation ON payment_checkouts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
