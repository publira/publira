DROP VIEW episode_surfaces;

DROP VIEW series_surfaces;

-- Dropping each column takes its CHECK constraint with it.
ALTER TABLE ONLY episodes
    DROP COLUMN availability;

ALTER TABLE ONLY series
    DROP COLUMN availability;
