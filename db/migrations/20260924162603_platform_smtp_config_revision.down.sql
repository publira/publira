ALTER TABLE ONLY platform_smtp_config
    DROP CONSTRAINT IF EXISTS platform_smtp_config_revision_positive_check,
    DROP COLUMN IF EXISTS revision;
