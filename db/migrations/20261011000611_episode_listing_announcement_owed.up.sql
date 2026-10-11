-- Whether a published episode still owes its followers the announcement of its
-- publication. The publication sets it, in the same transaction, when the
-- series is not public, since the follower fan-out answers nobody for such an
-- episode; the save or the job that later makes the series public queues the
-- announcement and clears it.
--
-- The column is what lets a series published again announce the episodes
-- added while it was private, and only those: an episode its followers were
-- already told about while the series was public owes nothing, so it keeps its
-- date and is not announced a second time.
--
-- It records the owed case rather than the announced one so that a listing
-- written by anything but a publication — every one published before this
-- column, and every one a seed inserts — owes nothing, rather than being
-- announced again the first time its series is published.
ALTER TABLE episode_listings
    ADD COLUMN announcement_owed boolean NOT NULL DEFAULT false;
