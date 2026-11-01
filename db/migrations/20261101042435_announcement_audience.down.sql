DROP FUNCTION announcement_audience_members(uuid, jsonb);

-- Dropping the column takes its CHECK constraint with it.
ALTER TABLE ONLY announcements
    DROP COLUMN audience;
