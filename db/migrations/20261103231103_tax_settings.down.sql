DROP TABLE IF EXISTS royalty_statement_creator_subtotals;

ALTER TABLE ONLY royalty_statements
    DROP CONSTRAINT IF EXISTS royalty_statements_withholding_check,
    DROP COLUMN IF EXISTS total_withholding,
    DROP COLUMN IF EXISTS total_tax,
    DROP COLUMN IF EXISTS withholding_rate_bps;

ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT IF EXISTS royalty_statement_lines_tax_check,
    DROP COLUMN IF EXISTS tax_amount,
    DROP COLUMN IF EXISTS tax_rate_bps;

DROP TRIGGER IF EXISTS subscription_payments_record_tax ON subscription_payments;
DROP FUNCTION IF EXISTS subscription_payments_record_tax();
DROP TRIGGER IF EXISTS purchases_record_tax ON purchases;
DROP FUNCTION IF EXISTS purchases_record_tax();
DROP FUNCTION IF EXISTS tenant_tax_rate_at(uuid, timestamp with time zone);

ALTER TABLE ONLY subscription_payments
    DROP CONSTRAINT IF EXISTS subscription_payments_tax_check,
    DROP COLUMN IF EXISTS tax_amount,
    DROP COLUMN IF EXISTS tax_rate_bps;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT IF EXISTS purchases_tax_check,
    DROP COLUMN IF EXISTS tax_amount,
    DROP COLUMN IF EXISTS tax_rate_bps;

DROP FUNCTION IF EXISTS tax_included(bigint, integer);

ALTER TABLE tenant_config
    DROP CONSTRAINT IF EXISTS tenant_config_invoice_registration_number_check,
    DROP CONSTRAINT IF EXISTS tenant_config_invoice_legal_name_check,
    DROP CONSTRAINT IF EXISTS tenant_config_withholding_rate_bps_check,
    DROP COLUMN IF EXISTS withholding_rate_bps,
    DROP COLUMN IF EXISTS invoice_registration_number,
    DROP COLUMN IF EXISTS invoice_legal_name;

DROP TABLE IF EXISTS tenant_tax_rates;
