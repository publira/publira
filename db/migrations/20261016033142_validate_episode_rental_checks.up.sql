-- Validates the CHECK constraints the previous migration added NOT VALID. It
-- is a file of its own because golang-migrate runs one file as one
-- transaction: on its own, VALIDATE CONSTRAINT takes SHARE UPDATE EXCLUSIVE,
-- which lets reads and writes go on while it scans the table.
ALTER TABLE ONLY episode_listings
    VALIDATE CONSTRAINT episode_listings_rental_check;

ALTER TABLE ONLY series_listings
    VALIDATE CONSTRAINT series_listings_rental_period_hours_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_kind_check;

ALTER TABLE ONLY purchases
    VALIDATE CONSTRAINT purchases_rental_expires_check;
