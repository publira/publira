-- INDEX: idx_episode_reading_positions_tenant_updated_at
-- The positions of a tenant last moved during one of its days, which is what
-- aggregate-content-stats reads to rebuild episode_page_reach_stats. Without it
-- a rebuild reads every position the tenant's readers ever saved. The episode
-- and the page are carried beside the key, so the day is counted from the
-- index alone.
--
-- CONCURRENTLY, so building it does not block the positions readers keep
-- saving, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_episode_reading_positions_tenant_updated_at ON episode_reading_positions USING btree (tenant_id, updated_at) INCLUDE (episode_id, page_index);
