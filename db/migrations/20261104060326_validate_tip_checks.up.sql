-- Validates the CHECK constraints the tips migration added NOT VALID. It is a
-- file of its own because golang-migrate runs one file as one transaction: on
-- its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads
-- and writes go on while it scans each table.
ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_kind_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_tip_check;

ALTER TABLE ONLY store_purchase_intents
    VALIDATE CONSTRAINT store_purchase_intents_kind_check;

ALTER TABLE ONLY royalty_statement_lines
    VALIDATE CONSTRAINT royalty_statement_lines_source_check;
