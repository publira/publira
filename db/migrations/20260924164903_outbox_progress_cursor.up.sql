-- COLUMN: outbox_events progress_cursor
-- How far a handler that works through its event in pages has got, so a run
-- that runs out of time hands the next run a place to resume from rather than
-- the start. NULL is the start; the value is the handler's own and nothing
-- else reads it.
ALTER TABLE ONLY outbox_events
    ADD COLUMN progress_cursor text;
