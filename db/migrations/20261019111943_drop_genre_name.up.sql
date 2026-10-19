-- COLUMN: genres name
-- A genre's name belongs to its translations now.
ALTER TABLE ONLY genres
    DROP COLUMN name;
