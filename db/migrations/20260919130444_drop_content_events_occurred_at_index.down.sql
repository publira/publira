CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_content_events_occurred_at ON content_events USING btree (occurred_at);
