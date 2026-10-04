-- INDEX: idx_access_tickets_active_staff_user_episode
-- At most one non-revoked staff ticket per (tenant, user, episode), which is
-- what serializes concurrent IssueAccessTicket calls, as the index it replaces
-- did. Wait-for-free tickets stay out of it: one that has expired is not
-- revoked, and the same reader using a ticket on the same episode again later
-- would collide with it.
--
-- CONCURRENTLY, so building it does not block the tickets staff keep issuing,
-- which is also why this statement is the whole file.
CREATE UNIQUE INDEX CONCURRENTLY idx_access_tickets_active_staff_user_episode ON access_tickets USING btree (tenant_id, user_id, episode_id) WHERE ((revoked_at IS NULL) AND (source = 'staff'::text));
