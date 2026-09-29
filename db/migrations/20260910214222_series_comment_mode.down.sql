-- Dropping the column takes series_listings_comment_mode_check with it.
ALTER TABLE ONLY series_listings
    DROP COLUMN IF EXISTS comment_mode;
