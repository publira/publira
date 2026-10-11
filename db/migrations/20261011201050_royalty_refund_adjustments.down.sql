DROP VIEW IF EXISTS royalty_uncarried_refunds;

-- An adjustment line has no place in the statement as it was before, and the
-- immutability trigger refuses to remove one, so it is set aside around the
-- delete.
ALTER TABLE royalty_statement_lines DISABLE TRIGGER royalty_statement_lines_immutable;
DELETE FROM royalty_statement_lines WHERE adjusted_statement_id IS NOT NULL;
ALTER TABLE royalty_statement_lines ENABLE TRIGGER royalty_statement_lines_immutable;

ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_amounts_check;
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT IF EXISTS royalty_statement_lines_tenant_adjusted_statement_id_fkey;
ALTER TABLE ONLY royalty_statement_lines
    DROP COLUMN IF EXISTS adjusted_statement_id;
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_amounts_check CHECK (((sale_count > 0) AND (refunded_amount >= 0) AND (gross_amount >= refunded_amount)));

ALTER TABLE ONLY royalty_statements
    DROP CONSTRAINT royalty_statements_amounts_check;
ALTER TABLE ONLY royalty_statements
    DROP COLUMN IF EXISTS total_adjustment;
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_amounts_check CHECK (((total_gross >= 0) AND (total_refunded >= 0) AND (total_payout >= 0)));

DROP TABLE IF EXISTS royalty_statement_purchases;
