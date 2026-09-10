-- The number of open reports that takes a comment off the site on its own.

-- COLUMN: tenant_config comment_auto_hide_report_threshold
-- How many distinct readers have to report one comment before it is hidden
-- without waiting for staff, and 0 for a tenant that wants no automatic
-- removal at all. A fixed count rather than a share of the episode's readers:
-- the view and comment totals a ratio would divide by come from the daily
-- aggregation and are up to a day behind the report being acted on, and a
-- count is a number a tenant can be told and an outcome staff can check
-- afterwards.
--
-- It defaults to 3 rather than to 0 because the setting only ever applies to a
-- tenant that has turned commenting on, and the removal is reversible: staff
-- restore what the threshold took down, and the reports that reached it are
-- waiting in the queue for exactly that review.
ALTER TABLE tenant_config
    ADD COLUMN comment_auto_hide_report_threshold integer DEFAULT 3 NOT NULL;

ALTER TABLE tenant_config
    ADD CONSTRAINT tenant_config_comment_auto_hide_report_threshold_check CHECK ((comment_auto_hide_report_threshold >= 0));
