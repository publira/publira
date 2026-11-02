-- The deliver-announcements ticker job asks every tenant for the scheduled rows
-- whose time has passed. The partial index holds only the rows still waiting.
CREATE INDEX CONCURRENTLY idx_announcements_due ON announcements USING btree (deliver_at) WHERE (delivered_at IS NULL);
