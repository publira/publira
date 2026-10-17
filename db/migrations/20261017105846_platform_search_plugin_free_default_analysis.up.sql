-- The default analysis is built on no plugin from this version on, where the
-- indices built before it are built for Japanese on analysis-kuromoji and
-- analysis-icu. A NULL analysis is the default, so moving the revision on for
-- every saved engine with an index that builds a language from it leaves a
-- build due, which rebuilds the indices with the new default the way any
-- change of the analysis is rebuilt, while the search keeps answering from the
-- indices it has.
UPDATE platform_search_config
SET revision = revision + 1,
    build_failed_revision = NULL,
    build_error = NULL,
    build_failed_at = NULL,
    updated_at = NOW()
WHERE engine <> 'sql'
  AND analysis IS NULL;
