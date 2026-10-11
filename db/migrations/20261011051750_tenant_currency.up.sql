-- COLUMN: tenant_payment_config currency
-- The ISO 4217 code, in capitals, of the one currency the tenant sells in. Every
-- amount the tenant stores is an integer in this currency's minor unit:
-- episode_listings.price, purchases.price_at_purchase and refunded_amount,
-- store_purchase_intents.price, unapplied_refunds.refunded_amount, and the
-- figures of the royalty statements. For a
-- currency without decimals, such as JPY, the minor unit is the currency
-- itself, so a price of 500 is 500 yen; for one with two, such as USD, it is
-- the hundredth, so the same 500 is 5.00 dollars.
--
-- The server refuses to change it once the tenant has a purchase, since every
-- amount already recorded is an amount in it. A tenant that never saved its
-- payment settings has no row and sells in JPY, which is also the default here
-- so that every row written before this column keeps selling as it did.
ALTER TABLE tenant_payment_config
    ADD COLUMN currency char(3) DEFAULT 'JPY' NOT NULL;

-- CONSTRAINT: tenant_payment_config tenant_payment_config_currency_check
ALTER TABLE ONLY tenant_payment_config
    ADD CONSTRAINT tenant_payment_config_currency_check CHECK ((currency ~ '^[A-Z]{3}$'::text));
