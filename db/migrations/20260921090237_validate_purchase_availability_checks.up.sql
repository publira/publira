-- Validates the CHECK constraints the previous migration added NOT VALID. It is
-- a file of its own because golang-migrate runs one file as one transaction:
-- validated alongside the ADD CONSTRAINT, the scan would still be held under
-- that statement's ACCESS EXCLUSIVE lock. On its own, VALIDATE CONSTRAINT takes
-- SHARE UPDATE EXCLUSIVE, which lets reads and writes go on.
ALTER TABLE ONLY tenant_config
    VALIDATE CONSTRAINT tenant_config_purchase_availability_check;

ALTER TABLE ONLY tenant_config
    VALIDATE CONSTRAINT tenant_config_app_store_url_check;

ALTER TABLE ONLY tenant_config
    VALIDATE CONSTRAINT tenant_config_google_play_url_check;

ALTER TABLE ONLY series
    VALIDATE CONSTRAINT series_purchase_availability_check;

ALTER TABLE ONLY episodes
    VALIDATE CONSTRAINT episodes_purchase_availability_check;
