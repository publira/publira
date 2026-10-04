-- The wait-for-free tickets were deleted by the down migration that restored
-- the uniqueness they could not satisfy, so every row left here is a staff one.
ALTER TABLE ONLY access_tickets
    DROP CONSTRAINT access_tickets_source_check,
    DROP COLUMN source;

DROP TABLE wait_free_ticket_states;

DROP TABLE series_wait_free_settings;
