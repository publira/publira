-- The text analyses of the catalog indices of single languages: a JSON object
-- from a locale to the settings.analysis that language's index is built with,
-- in place of analysis. A language it does not name is built from analysis,
-- so NULL builds every language from it. The serving configuration keeps the
-- ones its indices were built with, as it keeps serving_analysis. Neither is
-- kept on 'sql', which has no index.
ALTER TABLE platform_search_config
    ADD COLUMN locale_analyses text,
    ADD COLUMN serving_locale_analyses text,
    ADD CONSTRAINT platform_search_config_locale_analyses_check CHECK (((locale_analyses IS NULL) OR ((engine <> 'sql'::text) AND (jsonb_typeof((locale_analyses)::jsonb) = 'object'::text) AND ((locale_analyses)::jsonb <> '{}'::jsonb) AND (NOT jsonb_path_exists((locale_analyses)::jsonb, '$.* ? (@.type() != "object")'::jsonpath))))),
    ADD CONSTRAINT platform_search_config_serving_locale_analyses_check CHECK (((serving_locale_analyses IS NULL) OR ((serving_engine <> 'sql'::text) AND (jsonb_typeof((serving_locale_analyses)::jsonb) = 'object'::text) AND ((serving_locale_analyses)::jsonb <> '{}'::jsonb) AND (NOT jsonb_path_exists((serving_locale_analyses)::jsonb, '$.* ? (@.type() != "object")'::jsonpath)))));
