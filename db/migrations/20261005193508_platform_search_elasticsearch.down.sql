-- A row saved on Elasticsearch has nothing to fall back to but the SQL engine
-- every install starts on, so the down migration puts it there rather than
-- failing on the narrower check.
UPDATE platform_search_config
SET engine = 'sql', url = NULL, index_alias = NULL, username = NULL, password_encrypted = NULL
WHERE engine = 'elasticsearch';
UPDATE platform_search_config
SET serving_engine = 'sql', serving_url = NULL, serving_index_alias = NULL, serving_username = NULL, serving_password_encrypted = NULL
WHERE serving_engine = 'elasticsearch';
ALTER TABLE platform_search_config
    DROP CONSTRAINT platform_search_config_engine_check,
    ADD CONSTRAINT platform_search_config_engine_check CHECK ((engine = ANY (ARRAY['sql'::text, 'opensearch'::text]))),
    DROP CONSTRAINT platform_search_config_serving_engine_check,
    ADD CONSTRAINT platform_search_config_serving_engine_check CHECK ((serving_engine = ANY (ARRAY['sql'::text, 'opensearch'::text])));
