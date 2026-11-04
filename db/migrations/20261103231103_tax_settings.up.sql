-- Consumption tax and the qualified invoice details: the tenant's tax rate,
-- its withholding rate, the legal name and registration number its receipts
-- name, the tax recorded on each purchase and subscription payment, and the
-- tax and withholding a royalty statement states.
--
-- Prices stay tax-inclusive integers. A tenant that sets no rate records no
-- tax: every new column is nullable, NULL for a row made without a rate, and
-- the previous release's inserts, which name none of them, keep working. The
-- CHECK constraints on tables that already hold rows are added NOT VALID and
-- validated by the next migration.

-- TABLE: tenant_tax_rates
-- The tax rate a tenant's prices include, as it changed over time. Each change
-- is a new row applying from the moment it was saved, so the rate a purchase
-- was recorded at stays the one recorded on it after the tenant changes it.
-- rate_bps is in basis points, 1000 for 10%; NULL is a change to no rate,
-- after which nothing records tax until a rate is set again.
CREATE TABLE tenant_tax_rates (
    tenant_id uuid NOT NULL,
    applies_from timestamp with time zone NOT NULL,
    rate_bps integer,
    CONSTRAINT tenant_tax_rates_rate_bps_check CHECK (((rate_bps >= 1) AND (rate_bps <= 10000)))
);

-- CONSTRAINT: tenant_tax_rates tenant_tax_rates_pkey
-- Also what the rate in effect at an instant is looked up by.
ALTER TABLE ONLY tenant_tax_rates
    ADD CONSTRAINT tenant_tax_rates_pkey PRIMARY KEY (tenant_id, applies_from);

-- FK CONSTRAINT: tenant_tax_rates tenant_tax_rates_tenant_id_fkey
ALTER TABLE ONLY tenant_tax_rates
    ADD CONSTRAINT tenant_tax_rates_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_tax_rates
ALTER TABLE tenant_tax_rates ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_tax_rates tenant_tax_rates_tenant_isolation
CREATE POLICY tenant_tax_rates_tenant_isolation ON tenant_tax_rates
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: tenant_config invoice_legal_name
-- COLUMN: tenant_config invoice_registration_number
-- The name the tenant issues invoices under and its registration number under
-- the qualified invoice system, which a receipt and a reader's purchase
-- history name. NULL where the tenant has entered none.
--
-- COLUMN: tenant_config withholding_rate_bps
-- The rate, in basis points, withheld from each Author's payout when a royalty
-- statement is closed. NULL withholds nothing.
ALTER TABLE tenant_config
    ADD COLUMN invoice_legal_name text,
    ADD COLUMN invoice_registration_number text,
    ADD COLUMN withholding_rate_bps integer,
    ADD CONSTRAINT tenant_config_withholding_rate_bps_check CHECK (((withholding_rate_bps >= 1) AND (withholding_rate_bps <= 10000))),
    ADD CONSTRAINT tenant_config_invoice_legal_name_check CHECK ((char_length(invoice_legal_name) >= 1)),
    ADD CONSTRAINT tenant_config_invoice_registration_number_check CHECK ((char_length(invoice_registration_number) >= 1));

-- FUNCTION: tax_included
-- The tax a tax-inclusive amount includes at a rate in basis points: the
-- amount less the amount without tax, rounded down. NULL where there is no
-- rate. Integer division truncates toward zero, so a negative amount, a
-- statement's adjustment, includes exactly the negation of what its absolute
-- value would.
CREATE FUNCTION tax_included(amount bigint, rate_bps integer) RETURNS bigint
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
AS $$
    SELECT tax_included.amount - tax_included.amount * 10000 / (10000 + tax_included.rate_bps)
$$;

-- COLUMN: purchases tax_rate_bps
-- COLUMN: purchases tax_amount
-- The tenant's rate when the purchase was made and the tax its
-- price_at_purchase includes at that rate, both NULL for a purchase made while
-- the tenant had no rate. A purchase of a pack of coins records none: the
-- coins are a prepaid instrument, and the tax is recorded on the purchases
-- they pay for. A store's purchase records the tax its price includes as any
-- other does; its store column already says the store issued its receipt.
ALTER TABLE purchases
    ADD COLUMN tax_rate_bps integer,
    ADD COLUMN tax_amount integer;

-- CONSTRAINT: purchases purchases_tax_check
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_tax_check CHECK ((((tax_rate_bps IS NULL) AND (tax_amount IS NULL)) OR ((tax_rate_bps >= 1) AND (tax_rate_bps <= 10000) AND (tax_amount = tax_included(price_at_purchase, tax_rate_bps))))) NOT VALID;

-- COLUMN: subscription_payments tax_rate_bps
-- COLUMN: subscription_payments tax_amount
-- The same for a subscription payment, at the rate in effect when it was paid.
ALTER TABLE subscription_payments
    ADD COLUMN tax_rate_bps integer,
    ADD COLUMN tax_amount integer;

-- CONSTRAINT: subscription_payments subscription_payments_tax_check
ALTER TABLE ONLY subscription_payments
    ADD CONSTRAINT subscription_payments_tax_check CHECK ((((tax_rate_bps IS NULL) AND (tax_amount IS NULL)) OR ((tax_rate_bps >= 1) AND (tax_rate_bps <= 10000) AND (tax_amount = tax_included(amount, tax_rate_bps))))) NOT VALID;

-- FUNCTION: tenant_tax_rate_at
-- The rate a tenant's prices include at an instant: that of its latest change
-- applying by then, NULL where it has none.
CREATE FUNCTION tenant_tax_rate_at(tenant_id uuid, at_time timestamp with time zone) RETURNS integer
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
AS $$
    SELECT r.rate_bps
    FROM public.tenant_tax_rates r
    WHERE r.tenant_id = tenant_tax_rate_at.tenant_id
        AND r.applies_from <= tenant_tax_rate_at.at_time
    ORDER BY r.applies_from DESC
    LIMIT 1
$$;

-- FUNCTION: purchases_record_tax
-- Records the tax of a purchase as it is inserted, at the tenant's rate when it
-- was made, so every way a purchase is recorded records it alike, the previous
-- release's included. A row inserted with its tax already set keeps it.
--
-- SECURITY INVOKER: the role inserting the purchase reads the tenant's rates
-- under the same row-level security that let it insert the row.
CREATE FUNCTION purchases_record_tax() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $$
BEGIN
    IF NEW.tax_rate_bps IS NULL AND NEW.tax_amount IS NULL AND NEW.coin_pack_id IS NULL THEN
        NEW.tax_rate_bps := public.tenant_tax_rate_at(NEW.tenant_id, NEW.purchased_at);
        NEW.tax_amount := public.tax_included(NEW.price_at_purchase, NEW.tax_rate_bps);
    END IF;
    RETURN NEW;
END;
$$;

-- TRIGGER: purchases purchases_record_tax
CREATE TRIGGER purchases_record_tax
    BEFORE INSERT ON purchases
    FOR EACH ROW
    EXECUTE FUNCTION purchases_record_tax();

-- FUNCTION: subscription_payments_record_tax
-- purchases_record_tax for a subscription payment, at the rate when it was
-- paid.
CREATE FUNCTION subscription_payments_record_tax() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = pg_catalog, public, pg_temp
    AS $$
BEGIN
    IF NEW.tax_rate_bps IS NULL AND NEW.tax_amount IS NULL THEN
        NEW.tax_rate_bps := public.tenant_tax_rate_at(NEW.tenant_id, NEW.paid_at);
        NEW.tax_amount := public.tax_included(NEW.amount, NEW.tax_rate_bps);
    END IF;
    RETURN NEW;
END;
$$;

-- TRIGGER: subscription_payments subscription_payments_record_tax
CREATE TRIGGER subscription_payments_record_tax
    BEFORE INSERT ON subscription_payments
    FOR EACH ROW
    EXECUTE FUNCTION subscription_payments_record_tax();

-- COLUMN: royalty_statement_lines tax_rate_bps
-- COLUMN: royalty_statement_lines tax_amount
-- The rate of the sales or payments a line counts, and the tax its payout
-- includes at that rate. A month whose rate changed has a line per rate for
-- each credit. An adjustment line has the rate of the line it adjusts. Both
-- NULL for a line of sales made without a rate, and on every line closed
-- before statements carried tax.
ALTER TABLE ONLY royalty_statement_lines
    ADD COLUMN tax_rate_bps integer,
    ADD COLUMN tax_amount bigint;

-- CONSTRAINT: royalty_statement_lines royalty_statement_lines_tax_check
-- Recomputable from the line alone, as its payout is.
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tax_check CHECK ((((tax_rate_bps IS NULL) AND (tax_amount IS NULL)) OR ((tax_rate_bps >= 1) AND (tax_rate_bps <= 10000) AND (tax_amount = tax_included(payout_amount, tax_rate_bps))))) NOT VALID;

-- COLUMN: royalty_statements withholding_rate_bps
-- The tenant's withholding rate at close, kept as the time zone is, so a
-- closed statement keeps the rate it was cut with. NULL withheld nothing.
--
-- COLUMN: royalty_statements total_tax
-- The tax the lines' payouts include, NULL where no line has a rate.
--
-- COLUMN: royalty_statements total_withholding
-- What the Authors' subtotals withhold, NULL where withholding_rate_bps is.
ALTER TABLE ONLY royalty_statements
    ADD COLUMN withholding_rate_bps integer,
    ADD COLUMN total_tax bigint,
    ADD COLUMN total_withholding bigint;

-- CONSTRAINT: royalty_statements royalty_statements_withholding_check
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_withholding_check CHECK ((((withholding_rate_bps IS NULL) AND (total_withholding IS NULL)) OR ((withholding_rate_bps >= 1) AND (withholding_rate_bps <= 10000) AND (total_withholding >= 0)))) NOT VALID;

-- TABLE: royalty_statement_creator_subtotals
-- What a statement pays each Author: the payouts of their lines added up, the
-- tax those payouts include, and what is withheld from them. A statement has
-- one row per creator its lines name, in the order of the creator's first
-- line. An adjustment of a line closed before lines kept their creator's ID
-- names none, and the subtotal of such lines has no creator_id either.
--
-- withholding_amount is the statement's withholding_rate_bps of the payout
-- less its tax, rounded down, and nothing on a payout that is not above its
-- tax. NULL where the statement withheld nothing; tax_amount NULL where none
-- of the creator's lines has a rate. A statement closed before subtotals were
-- written has none.
CREATE TABLE royalty_statement_creator_subtotals (
    tenant_id uuid NOT NULL,
    statement_id uuid NOT NULL,
    -- The subtotal's position in the statement, starting at 1.
    "position" integer NOT NULL,
    -- No foreign key, as a statement line has none: the subtotal keeps the
    -- ID and the name it was closed with.
    creator_id uuid,
    creator_name text NOT NULL,
    payout_amount bigint NOT NULL,
    tax_amount bigint,
    withholding_amount bigint,
    CONSTRAINT royalty_statement_creator_subtotals_position_check CHECK (("position" > 0)),
    CONSTRAINT royalty_statement_creator_subtotals_withholding_amount_check CHECK ((withholding_amount >= 0))
);

-- CONSTRAINT: royalty_statement_creator_subtotals royalty_statement_creator_subtotals_pkey
ALTER TABLE ONLY royalty_statement_creator_subtotals
    ADD CONSTRAINT royalty_statement_creator_subtotals_pkey PRIMARY KEY (tenant_id, statement_id, "position");

-- INDEX: idx_royalty_statement_creator_subtotals_statement_id
-- Serves the cascade from a deleted statement, which goes with its tenant.
CREATE INDEX idx_royalty_statement_creator_subtotals_statement_id ON royalty_statement_creator_subtotals USING btree (statement_id);

-- FK CONSTRAINT: royalty_statement_creator_subtotals royalty_statement_creator_subtotals_tenant_statement_id_fkey
ALTER TABLE ONLY royalty_statement_creator_subtotals
    ADD CONSTRAINT royalty_statement_creator_subtotals_tenant_statement_id_fkey FOREIGN KEY (tenant_id, statement_id) REFERENCES royalty_statements(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: royalty_statement_creator_subtotals
ALTER TABLE royalty_statement_creator_subtotals ENABLE ROW LEVEL SECURITY;

-- POLICY: royalty_statement_creator_subtotals royalty_statement_creator_subtotals_tenant_isolation
CREATE POLICY royalty_statement_creator_subtotals_tenant_isolation ON royalty_statement_creator_subtotals
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TRIGGER: royalty_statement_creator_subtotals royalty_statement_creator_subtotals_immutable
-- Part of the statement it was written with, and as unchangeable.
CREATE TRIGGER royalty_statement_creator_subtotals_immutable
    BEFORE UPDATE OR DELETE ON royalty_statement_creator_subtotals
    FOR EACH ROW
    EXECUTE FUNCTION royalty_statements_refuse_changes();
