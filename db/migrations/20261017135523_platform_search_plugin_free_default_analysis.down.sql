-- The earlier server ships the default built for Japanese and does not know
-- which default an index was built with, so a saved engine that builds a
-- language from the default is left with a build due, which rebuilds its
-- indices with that definition.
UPDATE platform_search_config
SET revision = revision + 1,
    build_failed_revision = NULL,
    build_error = NULL,
    build_failed_at = NULL,
    updated_at = NOW()
WHERE engine <> 'sql'
  AND analysis IS NULL;
ALTER TABLE platform_search_config
    DROP CONSTRAINT platform_search_config_serving_default_analysis_version_check,
    DROP COLUMN serving_default_analysis_version;
