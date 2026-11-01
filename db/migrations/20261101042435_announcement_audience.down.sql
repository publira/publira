DROP FUNCTION announcement_audience_members(uuid, jsonb);

DROP POLICY announcements_audience_visibility ON announcements;

-- Dropping the column takes its CHECK constraint with it.
ALTER TABLE ONLY announcements
    DROP COLUMN audience;
