DROP VIEW IF EXISTS royalty_uncarried_refunds;

-- An adjustment line has no place in a statement as it was before, so it goes,
-- and the payout of a statement that carried one is put back to the sum of
-- the lines it keeps, which is what the restored check and every reader
-- before this migration expect it to be. The immutability triggers refuse
-- both, so they are set aside around them.
ALTER TABLE royalty_statement_lines DISABLE TRIGGER royalty_statement_lines_immutable;
ALTER TABLE royalty_statements DISABLE TRIGGER royalty_statements_immutable;
UPDATE royalty_statements rs
SET total_payout = COALESCE((
    SELECT sum(l.payout_amount)
    FROM royalty_statement_lines l
    WHERE l.tenant_id = rs.tenant_id
        AND l.statement_id = rs.id
        AND l.adjusted_statement_id IS NULL
), 0)
WHERE EXISTS (
    SELECT 1
    FROM royalty_statement_lines l
    WHERE l.tenant_id = rs.tenant_id
        AND l.statement_id = rs.id
        AND l.adjusted_statement_id IS NOT NULL
);
DELETE FROM royalty_statement_lines WHERE adjusted_statement_id IS NOT NULL;
ALTER TABLE royalty_statements ENABLE TRIGGER royalty_statements_immutable;
ALTER TABLE royalty_statement_lines ENABLE TRIGGER royalty_statement_lines_immutable;

ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_payout_check;
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT royalty_statement_lines_amounts_check;
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT IF EXISTS royalty_statement_lines_tenant_adjusted_line_fkey;
DROP INDEX IF EXISTS idx_royalty_statement_lines_adjusted_line;
ALTER TABLE ONLY royalty_statement_lines
    DROP CONSTRAINT IF EXISTS royalty_statement_lines_tenant_id_statement_id_line_number_key;
ALTER TABLE ONLY royalty_statement_lines
    DROP COLUMN IF EXISTS adjusted_line_number,
    DROP COLUMN IF EXISTS adjusted_statement_id;
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_amounts_check CHECK (((sale_count > 0) AND (refunded_amount >= 0) AND (gross_amount >= refunded_amount)));
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_payout_check CHECK ((payout_amount = (((gross_amount - refunded_amount) * share_bps) / 10000)));

ALTER TABLE ONLY royalty_statements
    DROP CONSTRAINT royalty_statements_amounts_check;
ALTER TABLE ONLY royalty_statements
    DROP COLUMN IF EXISTS total_adjustment;
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_amounts_check CHECK (((total_gross >= 0) AND (total_refunded >= 0) AND (total_payout >= 0)));

DROP TABLE IF EXISTS royalty_statement_purchases;
