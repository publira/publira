-- Validates the layout CHECK constraints the previous migration added NOT
-- VALID. It is a file of its own because golang-migrate runs one file as one
-- transaction: validated alongside the ADD CONSTRAINT, the scan would still be
-- held under that statement's ACCESS EXCLUSIVE lock. On its own, VALIDATE
-- CONSTRAINT takes SHARE UPDATE EXCLUSIVE, which lets reads and writes go on.
ALTER TABLE ONLY series_listings
    VALIDATE CONSTRAINT series_listings_reading_direction_check;

ALTER TABLE ONLY series_listings
    VALIDATE CONSTRAINT series_listings_spread_start_index_check;

ALTER TABLE ONLY episodes
    VALIDATE CONSTRAINT episodes_reading_direction_check;

ALTER TABLE ONLY episodes
    VALIDATE CONSTRAINT episodes_spread_start_index_check;
