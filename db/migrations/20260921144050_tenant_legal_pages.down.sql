-- Dropping the columns takes their foreign keys with them.
ALTER TABLE ONLY tenant_config
    DROP COLUMN privacy_page_id,
    DROP COLUMN terms_page_id;
