-- The two ways the public series list narrows on the listing row: the
-- serialization state, and the weekday a new episode is expected on.
--
-- Both filters are written as EXISTS over series_listings, so the planner can
-- drive the scan from whichever side is smaller — the ordering index on series
-- when the filter keeps most of the catalog, and these indexes when it keeps
-- a handful. Without them the second choice does not exist, and a rare weekday
-- costs a scan of every listing the tenant owns.
--
-- Neither index is built CONCURRENTLY. series_listings holds one row per
-- series and is written only when an editor saves one, so building it blocks
-- nothing a reader is waiting on, and the two statements can share a file.

-- INDEX: idx_series_listings_tenant_status
-- series_id closes the index on what the EXISTS actually asks for, so the
-- lookup is answered without visiting the table.
CREATE INDEX idx_series_listings_tenant_status ON series_listings USING btree (tenant_id, status, series_id);

-- INDEX: idx_series_listings_schedule_weekdays
-- GIN, because the column is an array and the filter asks whether it contains
-- one weekday. A btree could only compare whole arrays. The filter is written
-- as `schedule_weekdays @> ARRAY[$1]` rather than `$1 = ANY(...)` for the same
-- reason: containment is the operator this index answers.
CREATE INDEX idx_series_listings_schedule_weekdays ON series_listings USING gin (schedule_weekdays);
