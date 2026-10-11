-- Every amount Publira stores is an integer in the minor unit of a currency
-- named beside it, instead of an integer of yen. For a currency without
-- decimals, such as JPY, the minor unit is the currency itself, so a price of
-- 500 is 500 yen; for one with two, such as USD, it is the hundredth, so the
-- same 500 is 5.00 dollars.
--
-- Every amount written before this migration is in yen, so every new column is
-- added with 'JPY' as its default, which fills the rows already there without
-- rewriting the table, and then loses that default, so that each later writer
-- names the currency it means. The CHECK constraints on purchases and
-- store_purchase_intents, the two tables a busy install holds many rows of,
-- are added NOT VALID so this file takes its ACCESS EXCLUSIVE locks without
-- scanning them; the next migration validates them under a lock that lets
-- reads and writes continue.

-- COLUMN: platform_config default_currency
-- The currency of every tenant that has not saved payment settings of its own.
-- The platform settings saved before this column priced every tenant in yen,
-- so they keep JPY; a platform set up from here on starts on USD unless its
-- operator names another.
ALTER TABLE ONLY platform_config
    ADD COLUMN default_currency character(3) DEFAULT 'JPY'::bpchar NOT NULL,
    ADD CONSTRAINT platform_config_default_currency_check CHECK ((default_currency ~ '^[A-Z]{3}$'::text));
ALTER TABLE ONLY platform_config
    ALTER COLUMN default_currency SET DEFAULT 'USD'::bpchar;

-- COLUMN: tenant_payment_config currency
-- The one currency the tenant sells in, which an episode's price is in. It has
-- to be one the provider charges in, and the server refuses to change it once
-- the tenant has a purchase.
ALTER TABLE ONLY tenant_payment_config
    ADD COLUMN currency character(3) DEFAULT 'JPY'::bpchar NOT NULL,
    ADD CONSTRAINT tenant_payment_config_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text));
ALTER TABLE ONLY tenant_payment_config
    ALTER COLUMN currency DROP DEFAULT;

-- COLUMN: purchases currency
-- The currency price_at_purchase and refunded_amount are in: the one the
-- reader paid in. It is the tenant's, except for a payment started before the
-- tenant changed its currency and completed after, which is recorded in the
-- currency it was taken in rather than refused.
ALTER TABLE ONLY purchases
    ADD COLUMN currency character(3) DEFAULT 'JPY'::bpchar NOT NULL,
    ADD CONSTRAINT purchases_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)) NOT VALID;
ALTER TABLE ONLY purchases
    ALTER COLUMN currency DROP DEFAULT;

-- COLUMN: store_purchase_intents currency
-- The currency price is in, the tenant's when the intent was opened, which
-- becomes the purchase's currency as price becomes its price.
ALTER TABLE ONLY store_purchase_intents
    ADD COLUMN currency character(3) DEFAULT 'JPY'::bpchar NOT NULL,
    ADD CONSTRAINT store_purchase_intents_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text)) NOT VALID;
ALTER TABLE ONLY store_purchase_intents
    ALTER COLUMN currency DROP DEFAULT;

-- COLUMN: unapplied_refunds currency
-- The currency refunded_amount is in, and NULL exactly when refunded_amount
-- is: a refund that reported no amount has no currency either. The amount is
-- applied only to a purchase in the same currency, and any other is refunded
-- its whole price. Every amount held before this column was in yen, since a
-- refund in any other currency was held without one.
ALTER TABLE ONLY unapplied_refunds
    ADD COLUMN currency character(3);
UPDATE unapplied_refunds
SET currency = 'JPY'
WHERE refunded_amount IS NOT NULL;
ALTER TABLE ONLY unapplied_refunds
    ADD CONSTRAINT unapplied_refunds_currency_check CHECK (((currency ~ '^[A-Z]{3}$'::text) AND (refunded_amount IS NOT NULL)) OR ((currency IS NULL) AND (refunded_amount IS NULL)));

-- COLUMN: royalty_statements currency
-- The currency the statement's totals and lines are in: the tenant's when the
-- month was closed, and the only sales it counts are those paid in it. A
-- statement never changes after its close, so it keeps the currency it was
-- closed in rather than taking the tenant's later one.
ALTER TABLE ONLY royalty_statements
    ADD COLUMN currency character(3) DEFAULT 'JPY'::bpchar NOT NULL,
    ADD CONSTRAINT royalty_statements_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text));
ALTER TABLE ONLY royalty_statements
    ALTER COLUMN currency DROP DEFAULT;
