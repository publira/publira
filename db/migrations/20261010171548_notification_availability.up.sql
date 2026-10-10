-- Which surfaces — the web storefront, the mobile app, or both — a notification
-- may be shown on, in the vocabulary series.availability uses. A notification
-- about an episode leads to that episode, so it is shown only where a reader
-- can open the episode; every other notification is shown everywhere.
--
-- The default is 'all' because that is where every notification already filed
-- is shown, and a constant default adds the column without rewriting the
-- table. The CHECK constraint is added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE lock without scanning notifications; the next migration validates
-- it under a lock that lets reads and writes continue.

-- COLUMN: notifications availability
ALTER TABLE ONLY notifications
    ADD COLUMN availability text DEFAULT 'all'::text NOT NULL,
    ADD CONSTRAINT notifications_availability_check CHECK ((availability = ANY (ARRAY['all'::text, 'web'::text, 'app'::text]))) NOT VALID;
