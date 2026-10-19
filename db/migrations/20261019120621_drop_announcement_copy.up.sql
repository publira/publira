-- COLUMN: announcements title, body
-- Both belong to the announcement's translations now.
ALTER TABLE ONLY announcements
    DROP COLUMN title,
    DROP COLUMN body;
