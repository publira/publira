-- The text analysis of the catalog index: its settings.analysis, as JSON,
-- which has to define the analyzers and the normalizer the mapping in the
-- server refers to. NULL is the default the server ships, built for Japanese.
-- The serving configuration keeps the one its index was built with, so a save
-- that changes nothing but the analysis is built into a new index before the
-- search moves onto it. Neither is kept on 'sql', which has no index.
ALTER TABLE platform_search_config
    ADD COLUMN analysis text,
    ADD COLUMN serving_analysis text,
    ADD CONSTRAINT platform_search_config_analysis_check CHECK (((analysis IS NULL) OR ((engine <> 'sql'::text) AND (jsonb_typeof((analysis)::jsonb) = 'object'::text)))),
    ADD CONSTRAINT platform_search_config_serving_analysis_check CHECK (((serving_analysis IS NULL) OR ((serving_engine <> 'sql'::text) AND (jsonb_typeof((serving_analysis)::jsonb) = 'object'::text))));

-- The default analysis names its analyzers by their role from this version on,
-- where the indices built before it name them ja_text, ja_reading, and
-- ja_exact. Moving the revision on leaves a build due for every saved engine
-- with an index, which rebuilds it under the new names the way any change of
-- the analysis is rebuilt, while the search keeps answering from the index it
-- has.
UPDATE platform_search_config
SET revision = revision + 1,
    build_failed_revision = NULL,
    build_error = NULL,
    build_failed_at = NULL,
    updated_at = NOW()
WHERE engine <> 'sql';
