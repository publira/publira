-- When the followers of a published episode were told about it. NULL means
-- they have not been: the episode is not published, or no reader could open it
-- when it was, because its series was not public or it was shown on no
-- surface, and the fan-out answers nobody for such an episode.
--
-- The column is what lets a series published again announce the episodes
-- added while it was private, and only those: an episode its followers were
-- already told about while the series was public keeps its date and is not
-- announced a second time. Taking an episode off the site leaves the column as
-- it is, for the same reason.
ALTER TABLE episode_listings
    ADD COLUMN announced_at timestamp with time zone;

-- Every episode already published was announced by the publication that
-- promoted it, or published before the fan-out asked whether a reader could
-- open it, so none of them is owed an announcement.
UPDATE episode_listings
SET announced_at = published_at
WHERE status = 'published'
    AND published_at IS NOT NULL;
