ALTER TABLE ONLY platform_config
    DROP CONSTRAINT IF EXISTS platform_config_revision_positive_check,
    DROP COLUMN IF EXISTS revision;
