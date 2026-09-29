-- The retention purge now deletes one tenant at a time through
-- idx_content_events_tenant_occurred_at, and nothing else reads content_events
-- across tenants, so this index only costs every event insert.
DROP INDEX CONCURRENTLY IF EXISTS idx_content_events_occurred_at;
