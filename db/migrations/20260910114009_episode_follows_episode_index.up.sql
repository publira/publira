-- INDEX: idx_episode_follows_tenant_episode_user
-- The read that starts from the episode: who asked to hear about it. The
-- counterpart of idx_series_follows_tenant_series_user, for the branch of the
-- new-episode fan-out that reads the episode's own followers.
--
-- CONCURRENTLY, and alone in its file, for the reason given there.
CREATE INDEX CONCURRENTLY idx_episode_follows_tenant_episode_user ON episode_follows USING btree (tenant_id, episode_id, user_id);
