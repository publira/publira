-- A validated constraint cannot be marked NOT VALID again, so each is recreated
-- as the previous migration left it.
ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_tax_check,
    ADD CONSTRAINT purchases_tax_check CHECK ((((tax_rate_bps IS NULL) AND (tax_amount IS NULL)) OR ((tax_rate_bps >= 1) AND (tax_rate_bps <= 10000) AND (tax_amount = tax_included(price_at_purchase, tax_rate_bps))))) NOT VALID;

ALTER TABLE ONLY subscription_payments
    DROP CONSTRAINT subscription_payments_tax_check,
    ADD CONSTRAINT subscription_payments_tax_check CHECK ((((tax_rate_bps IS NULL) AND (tax_amount IS NULL)) OR ((tax_rate_bps >= 1) AND (tax_rate_bps <= 10000) AND (tax_amount = tax_included(amount, tax_rate_bps))))) NOT VALID;

ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_tax_check,
    ADD CONSTRAINT royalty_statement_lines_tax_check CHECK ((((tax_rate_bps IS NULL) AND (tax_amount IS NULL)) OR ((tax_rate_bps >= 1) AND (tax_rate_bps <= 10000) AND (((adjusted_statement_id IS NULL) AND (tax_amount = tax_included(payout_amount, tax_rate_bps))) OR ((adjusted_statement_id IS NOT NULL) AND (tax_amount <= 0)))))) NOT VALID;

ALTER TABLE ONLY royalty_statements
    DROP CONSTRAINT royalty_statements_withholding_check,
    ADD CONSTRAINT royalty_statements_withholding_check CHECK ((((withholding_rate_bps IS NULL) AND (total_withholding IS NULL)) OR ((withholding_rate_bps >= 1) AND (withholding_rate_bps <= 10000) AND (total_withholding >= 0)))) NOT VALID;
