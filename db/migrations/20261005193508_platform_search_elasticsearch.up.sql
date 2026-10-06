-- Elasticsearch runs the OpenSearch backend unchanged: every analyzer, query,
-- and write the backend sends is common to both, and the engine is named apart
-- only so the connection test can tell the operator which product answered.
ALTER TABLE platform_search_config
    DROP CONSTRAINT platform_search_config_engine_check,
    ADD CONSTRAINT platform_search_config_engine_check CHECK ((engine = ANY (ARRAY['sql'::text, 'opensearch'::text, 'elasticsearch'::text]))),
    DROP CONSTRAINT platform_search_config_serving_engine_check,
    ADD CONSTRAINT platform_search_config_serving_engine_check CHECK ((serving_engine = ANY (ARRAY['sql'::text, 'opensearch'::text, 'elasticsearch'::text])));
