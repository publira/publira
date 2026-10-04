-- The restored index holds every source to one non-revoked ticket per reader
-- and episode, which the wait-for-free tickets do not satisfy, so they go
-- first: rolling the feature back takes back what it granted. Both statements
-- share this file's transaction, so no ticket can be used between the delete
-- and the build, and the build is therefore not CONCURRENTLY.
DELETE FROM access_tickets
WHERE source = 'wait_free';

-- INDEX: idx_access_tickets_active_user_episode
-- At most one non-revoked ticket per (tenant, user, episode). Concurrent issue is serialized by this unique partial index.
CREATE UNIQUE INDEX idx_access_tickets_active_user_episode ON access_tickets USING btree (tenant_id, user_id, episode_id) WHERE (revoked_at IS NULL);
