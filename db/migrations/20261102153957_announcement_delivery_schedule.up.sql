-- COLUMN: announcements deliver_at, delivered_at
-- deliver_at is the instant the console asked the announcement to go out at,
-- and delivered_at the instant its notification event was queued, which is
-- what "delivered" means to every read: readers are shown an announcement only
-- once delivered_at is set, and the console may edit or delete one only until
-- then. An announcement asked to go out at once has both set to the same
-- instant; a scheduled one has delivered_at NULL until the ticker job reaches
-- its deliver_at.
--
-- Every announcement already posted was delivered when it was created, so
-- delivered_at is backfilled from created_at. deliver_at is left NULL on those
-- rows: nobody asked them for a time.
--
-- delivered_at defaults to now() once the backfill is done, because the
-- previous release's CreateAnnouncement names neither column and queues the
-- event in the same transaction, so a row it writes is delivered the moment it
-- commits.
ALTER TABLE ONLY announcements
    ADD COLUMN deliver_at timestamp with time zone,
    ADD COLUMN delivered_at timestamp with time zone;

UPDATE announcements
SET delivered_at = created_at;

ALTER TABLE ONLY announcements
    ALTER COLUMN delivered_at SET DEFAULT now();
