-- A scheduled announcement nobody was told about has no shape the earlier
-- schema can hold: every row there is delivered, so it is deleted with its
-- translations rather than published by the rollback.
DELETE FROM announcements
WHERE delivered_at IS NULL;

ALTER TABLE ONLY announcements
    DROP COLUMN delivered_at,
    DROP COLUMN deliver_at;
