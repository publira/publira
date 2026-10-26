-- Take the active days back out. The content events still inside the
-- retention period are untouched, but a day whose events are gone cannot be
-- filed again.
DROP TABLE IF EXISTS reader_daily_activity;
