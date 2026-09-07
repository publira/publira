ALTER TABLE ONLY series_listings
    DROP CONSTRAINT IF EXISTS series_listings_age_rating_check,
    DROP CONSTRAINT IF EXISTS series_listings_schedule_weekdays_check,
    DROP CONSTRAINT IF EXISTS series_listings_status_check,
    DROP COLUMN IF EXISTS age_rating,
    DROP COLUMN IF EXISTS schedule_weekdays,
    DROP COLUMN IF EXISTS status;
