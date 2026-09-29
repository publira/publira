-- Dropping the column takes its CHECK constraint with it.
ALTER TABLE ONLY tenant_config
    DROP COLUMN app_purchase_route;

DROP TABLE tenant_google_play_config;

DROP TABLE tenant_app_store_config;
