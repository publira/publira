-- INDEX: idx_series_pending_publications
-- The apply-series-publications batch, which reads only the published series
-- whose drop it has not recorded yet. That is a series scheduled for a future
-- instant, or one whose instant passed since the last pass, so the partial
-- index stays about as small as the work queue.
--
-- CONCURRENTLY, so building it does not block the console saving series, which
-- is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_series_pending_publications ON series USING btree (published_at)
    WHERE (is_published AND (publication_revalidated_at IS NULL));
