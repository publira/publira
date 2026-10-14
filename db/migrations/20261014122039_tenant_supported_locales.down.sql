ALTER TABLE ONLY tenants
    DROP CONSTRAINT tenants_supported_locales_check;

ALTER TABLE tenants
    DROP COLUMN supported_locales;
