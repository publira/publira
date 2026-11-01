-- Validates the CHECK constraint the subscription payments migration added NOT
-- VALID. It is a file of its own because golang-migrate runs one file as one
-- transaction: on its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE,
-- which lets reads and writes go on while it scans the table.
ALTER TABLE ONLY royalty_statement_lines
    VALIDATE CONSTRAINT royalty_statement_lines_source_check;
