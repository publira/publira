-- Without the columns every index is built with the definition the earlier
-- server ships, so a saved engine with an index is left with a build due, which
-- rebuilds it with that definition, whatever analysis it was built with here.
UPDATE platform_search_config
SET revision = revision + 1,
    build_failed_revision = NULL,
    build_error = NULL,
    build_failed_at = NULL,
    updated_at = NOW()
WHERE engine <> 'sql';
ALTER TABLE platform_search_config
    DROP CONSTRAINT platform_search_config_serving_analysis_check,
    DROP CONSTRAINT platform_search_config_analysis_check,
    DROP COLUMN serving_analysis,
    DROP COLUMN analysis;
