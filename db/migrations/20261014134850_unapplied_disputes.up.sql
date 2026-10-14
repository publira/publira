-- A dispute that arrived before the purchase it disputes.
--
-- The same ordering a held refund answers: a provider need order neither its
-- notifications nor its retries, so the notification of a dispute can reach us
-- while the one that creates the purchase is still being retried.
-- Acknowledging the dispute and forgetting it would let that retry create a
-- purchase that opens the episode for a charge the reader has disputed.

-- TABLE: unapplied_disputes
-- One row per disputed payment that has no purchase here yet. The row is
-- deleted once the purchase has been revoked, so the table holds only what is
-- still outstanding.
CREATE TABLE unapplied_disputes (
    tenant_id uuid NOT NULL,
    provider text NOT NULL,
    provider_payment_id text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: unapplied_disputes unapplied_disputes_pkey
-- The payment is the whole identity: a repeated delivery of the same dispute,
-- and a second dispute of the same charge, both land on this row.
ALTER TABLE ONLY unapplied_disputes
    ADD CONSTRAINT unapplied_disputes_pkey PRIMARY KEY (tenant_id, provider, provider_payment_id);

-- FK CONSTRAINT: unapplied_disputes unapplied_disputes_tenant_id_fkey
ALTER TABLE ONLY unapplied_disputes
    ADD CONSTRAINT unapplied_disputes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: unapplied_disputes
ALTER TABLE unapplied_disputes ENABLE ROW LEVEL SECURITY;

-- POLICY: unapplied_disputes unapplied_disputes_tenant_isolation
-- The same isolation purchases carries. The webhook that writes a row runs on
-- the storefront's own connection.
CREATE POLICY unapplied_disputes_tenant_isolation ON unapplied_disputes
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
