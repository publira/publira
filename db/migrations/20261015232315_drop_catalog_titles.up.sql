-- COLUMN: series title, series_listings synopsis, episodes title
-- All three belong to the translations now. Dropping series.title takes
-- idx_series_tenant_title and idx_series_tenant_label_title with it.
ALTER TABLE ONLY series
    DROP COLUMN title;

ALTER TABLE ONLY series_listings
    DROP COLUMN synopsis;

ALTER TABLE ONLY episodes
    DROP COLUMN title;
