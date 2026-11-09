-- INDEX: idx_reader_daily_activity_tenant_series_id
-- The days its readers were active on a series, which deleting the series
-- takes with it through the cascading foreign key. Nothing purges the table,
-- so without it the cascade reads every row the tenant's readers ever left.
--
-- CONCURRENTLY, so building it does not block the daily rebuild that keeps
-- writing the table, which is also why this statement is the whole file.
CREATE INDEX CONCURRENTLY idx_reader_daily_activity_tenant_series_id ON reader_daily_activity USING btree (tenant_id, series_id);
