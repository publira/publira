-- INDEX: idx_episode_reads_tenant_user_read_at
-- The reader's own reading history, newest first. The primary key is
-- (tenant_id, user_id, episode_id), so it answers "did this member finish this
-- episode" but orders nothing by time; the keyset scan behind
-- ListMyEpisodeReads pages on (read_at, id) instead.
--
-- id is the tiebreaker rather than episode_id because it is the sort key the
-- cursor token carries, and episode_reads.id is unique on its own.
CREATE INDEX idx_episode_reads_tenant_user_read_at ON episode_reads USING btree (tenant_id, user_id, read_at DESC, id DESC);
