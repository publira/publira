-- A validated constraint cannot be marked NOT VALID again, so each is recreated
-- as the previous migration left it.
ALTER TABLE ONLY episode_listings
    DROP CONSTRAINT episode_listings_rental_check,
    ADD CONSTRAINT episode_listings_rental_check CHECK ((((rental_price IS NULL) = (rental_period_hours IS NULL)) AND ((rental_price IS NULL) OR ((rental_price > 0) AND (rental_price < price) AND (rental_period_hours > 0))))) NOT VALID;

ALTER TABLE ONLY series_listings
    DROP CONSTRAINT series_listings_rental_period_hours_check,
    ADD CONSTRAINT series_listings_rental_period_hours_check CHECK (((rental_period_hours IS NULL) OR (rental_period_hours > 0))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_kind_check,
    ADD CONSTRAINT purchases_kind_check CHECK ((kind = ANY (ARRAY['rental'::text, 'purchase'::text]))) NOT VALID;

ALTER TABLE ONLY purchases
    DROP CONSTRAINT purchases_rental_expires_check,
    ADD CONSTRAINT purchases_rental_expires_check CHECK (((kind <> 'rental'::text) OR (expires_at IS NOT NULL))) NOT VALID;
