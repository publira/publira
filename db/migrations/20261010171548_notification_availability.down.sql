-- Dropping the column takes its CHECK constraint with it.
ALTER TABLE ONLY notifications
    DROP COLUMN availability;
