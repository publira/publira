DROP VIEW episode_purchase_availability;

-- Dropping each column takes its CHECK constraint with it.
ALTER TABLE ONLY episodes
    DROP COLUMN purchase_availability;

ALTER TABLE ONLY series
    DROP COLUMN purchase_availability;

ALTER TABLE ONLY tenant_config
    DROP COLUMN google_play_url,
    DROP COLUMN app_store_url,
    DROP COLUMN purchase_availability;
