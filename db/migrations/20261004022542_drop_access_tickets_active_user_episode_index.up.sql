-- idx_access_tickets_active_user_episode held every source to one non-revoked
-- ticket per reader and episode. idx_access_tickets_active_staff_user_episode
-- keeps that rule for staff tickets and idx_access_tickets_user_episode keeps
-- the lookup, so this one would only refuse a reader's second wait-for-free use
-- of the same episode.
--
-- CONCURRENTLY, so dropping it does not block reads of the table, which is also
-- why this statement is the whole file.
DROP INDEX CONCURRENTLY IF EXISTS idx_access_tickets_active_user_episode;
