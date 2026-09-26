ALTER POLICY unapplied_refunds_tenant_isolation ON unapplied_refunds
    RENAME TO unapplied_stripe_refunds_tenant_isolation;

ALTER TABLE unapplied_refunds
    RENAME CONSTRAINT fk_unapplied_refunds_tenant_id TO fk_unapplied_stripe_refunds_tenant_id;

ALTER TABLE unapplied_refunds
    RENAME CONSTRAINT unapplied_refunds_refunded_amount_check TO unapplied_stripe_refunds_refunded_amount_check;

ALTER TABLE ONLY unapplied_refunds
    DROP CONSTRAINT unapplied_refunds_pkey;

ALTER TABLE ONLY unapplied_refunds
    ADD CONSTRAINT unapplied_stripe_refunds_pkey PRIMARY KEY (tenant_id, provider_payment_id);

ALTER TABLE unapplied_refunds
    DROP COLUMN provider;

ALTER TABLE unapplied_refunds
    RENAME COLUMN provider_payment_id TO stripe_payment_intent_id;

ALTER TABLE unapplied_refunds
    RENAME TO unapplied_stripe_refunds;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_provider_check;

ALTER TABLE purchases
    DROP COLUMN provider;

ALTER TABLE purchases
    RENAME COLUMN provider_payment_id TO stripe_payment_intent_id;

ALTER TABLE purchases
    RENAME COLUMN provider_checkout_id TO stripe_checkout_session_id;
