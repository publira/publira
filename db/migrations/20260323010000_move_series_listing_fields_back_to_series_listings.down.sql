ALTER TABLE series
    ADD COLUMN synopsis TEXT,
    ADD COLUMN reading_period_hours INT,
    ADD COLUMN created_by UUID REFERENCES users(id),
    ADD COLUMN updated_by UUID REFERENCES users(id);

UPDATE series s
SET synopsis = sl.synopsis,
    reading_period_hours = sl.reading_period_hours,
    updated_at = NOW()
FROM series_listings sl
WHERE sl.series_id = s.id;
