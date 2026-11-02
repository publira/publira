DROP FUNCTION IF EXISTS episode_review_cleared(uuid, timestamp with time zone);

DROP TABLE IF EXISTS episode_reviews;

ALTER TABLE episode_listings
    DROP CONSTRAINT IF EXISTS episode_listings_review_approved_at_check,
    DROP CONSTRAINT IF EXISTS episode_listings_review_state_check,
    DROP COLUMN IF EXISTS review_approved_at,
    DROP COLUMN IF EXISTS review_state;

ALTER TABLE tenant_config
    DROP COLUMN IF EXISTS episode_review_required;
