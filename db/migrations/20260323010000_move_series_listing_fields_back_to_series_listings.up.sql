INSERT INTO series_listings (
    series_id,
    synopsis,
    reading_period_hours
)
SELECT s.id,
    s.synopsis,
    s.reading_period_hours
FROM series s
ON CONFLICT (series_id) DO
UPDATE
SET synopsis = EXCLUDED.synopsis,
    reading_period_hours = EXCLUDED.reading_period_hours;

ALTER TABLE series
    DROP COLUMN IF EXISTS updated_by,
    DROP COLUMN IF EXISTS created_by,
    DROP COLUMN IF EXISTS reading_period_hours,
    DROP COLUMN IF EXISTS synopsis;
