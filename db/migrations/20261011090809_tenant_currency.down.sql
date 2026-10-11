ALTER TABLE ONLY unapplied_refunds
    DROP COLUMN currency;

ALTER TABLE ONLY store_purchase_intents
    DROP COLUMN currency;

ALTER TABLE ONLY purchases
    DROP COLUMN currency;

ALTER TABLE ONLY tenant_payment_config
    DROP COLUMN currency;

ALTER TABLE ONLY platform_config
    DROP COLUMN default_currency;
