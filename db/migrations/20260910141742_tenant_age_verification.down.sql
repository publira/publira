ALTER TABLE tenant_config
    DROP CONSTRAINT tenant_config_age_verification_check;

ALTER TABLE tenant_config
    DROP COLUMN age_verification;
