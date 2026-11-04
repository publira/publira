-- Validates the CHECK constraints the tax migration added NOT VALID. It is a
-- file of its own because golang-migrate runs one file as one transaction: on
-- its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads
-- and writes go on while it scans each table. Every row already there has the
-- new columns NULL, which each constraint accepts.
ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_tax_check;

ALTER TABLE ONLY subscription_payments
    VALIDATE CONSTRAINT subscription_payments_tax_check;

ALTER TABLE ONLY royalty_statement_lines
    VALIDATE CONSTRAINT royalty_statement_lines_tax_check;

ALTER TABLE ONLY royalty_statements
    VALIDATE CONSTRAINT royalty_statements_withholding_check;
