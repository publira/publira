-- Take the stored totals back out. content_daily_stats is untouched, so a
-- re-applied up migration sums them again.
DROP TABLE IF EXISTS tenant_rating_totals;
