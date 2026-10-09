-- COLUMN: tenants default_reading_period_hours
-- Nothing could set it, and the new-series form, the one place that read it,
-- starts at no limit instead. A series' reading period is where a new
-- episode's starts, so a tenant-wide default for that default goes rather than
-- gaining a setter.
ALTER TABLE ONLY tenants
    DROP COLUMN default_reading_period_hours;
