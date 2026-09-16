-- Dropping the columns takes their CHECK constraints with them.
ALTER TABLE ONLY episodes
    DROP COLUMN spread_start_index,
    DROP COLUMN reading_direction;

ALTER TABLE ONLY series_listings
    DROP COLUMN spread_start_index,
    DROP COLUMN reading_direction;
