-- A store refund that arrived before the purchase it reverses.
--
-- A store purchase is recorded when the app confirms it, and an app that was
-- killed, offline, or uninstalled may confirm days later or never. A refund the
-- store reports in between has no purchase to land on; this table is where it
-- waits, so the confirmation that finally records the purchase records it
-- refunded.

-- TABLE: unapplied_store_refunds
-- One row per store transaction refunded with no purchase here yet, deleted
-- once the refund has been written onto the purchase. A store refunds a
-- consumable in full, so the row holds no amount: it is applied as a refund of
-- the whole price.
CREATE TABLE unapplied_store_refunds (
    tenant_id uuid NOT NULL,
    store text NOT NULL,
    store_transaction_id text NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT unapplied_store_refunds_store_check CHECK ((store = ANY (ARRAY['app_store'::text, 'google_play'::text])))
);

-- CONSTRAINT: unapplied_store_refunds unapplied_store_refunds_pkey
-- The transaction is the whole identity, so a repeated notification and every
-- poll that reads the same voided purchase land on this row.
ALTER TABLE ONLY unapplied_store_refunds
    ADD CONSTRAINT unapplied_store_refunds_pkey PRIMARY KEY (tenant_id, store, store_transaction_id);

-- FK CONSTRAINT: unapplied_store_refunds unapplied_store_refunds_tenant_id_fkey
ALTER TABLE ONLY unapplied_store_refunds
    ADD CONSTRAINT unapplied_store_refunds_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: unapplied_store_refunds
ALTER TABLE unapplied_store_refunds ENABLE ROW LEVEL SECURITY;

-- POLICY: unapplied_store_refunds unapplied_store_refunds_tenant_isolation
CREATE POLICY unapplied_store_refunds_tenant_isolation ON unapplied_store_refunds
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
