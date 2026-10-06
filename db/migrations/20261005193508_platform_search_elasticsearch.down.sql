-- A row saved on Elasticsearch has nothing to fall back to but the SQL engine
-- every install starts on, so the down migration puts it there rather than
-- failing on the narrower check. The search moves onto it at once, as a save of
-- sql would, and a failure recorded for the Elasticsearch build goes with it.
UPDATE platform_search_config
SET engine = 'sql',
    url = NULL,
    index_alias = NULL,
    username = NULL,
    password_encrypted = NULL,
    serving_revision = revision,
    serving_engine = 'sql',
    serving_url = NULL,
    serving_index_alias = NULL,
    serving_username = NULL,
    serving_password_encrypted = NULL,
    serving_since = NOW(),
    build_failed_revision = NULL,
    build_error = NULL,
    build_failed_at = NULL
WHERE engine = 'elasticsearch';
-- What is left serving Elasticsearch is building another engine, whose build
-- carries on from the SQL engine instead.
UPDATE platform_search_config
SET serving_engine = 'sql',
    serving_url = NULL,
    serving_index_alias = NULL,
    serving_username = NULL,
    serving_password_encrypted = NULL,
    serving_since = NOW()
WHERE serving_engine = 'elasticsearch';
ALTER TABLE platform_search_config
    DROP CONSTRAINT platform_search_config_engine_check,
    ADD CONSTRAINT platform_search_config_engine_check CHECK ((engine = ANY (ARRAY['sql'::text, 'opensearch'::text]))),
    DROP CONSTRAINT platform_search_config_serving_engine_check,
    ADD CONSTRAINT platform_search_config_serving_engine_check CHECK ((serving_engine = ANY (ARRAY['sql'::text, 'opensearch'::text])));
