-- The version of the default analysis the serving indices were built with,
-- where any language's index was built from the default: the server ships one
-- default, and moves its version on whenever it changes it. A serving
-- configuration on another version, or on none, has a build due, which
-- rebuilds its indices with the default the server ships while the search
-- keeps answering from the ones it has. NULL on 'sql', which keeps no index,
-- and on the indices built before the version was recorded, which a server
-- that records it therefore rebuilds once. A process of an earlier release
-- that builds an index leaves the column as it was, so an index it built with
-- its own default is not taken for one built with the new.
ALTER TABLE platform_search_config
    ADD COLUMN serving_default_analysis_version integer,
    ADD CONSTRAINT platform_search_config_serving_default_analysis_version_check CHECK (((serving_default_analysis_version IS NULL) OR ((serving_engine <> 'sql'::text) AND (serving_default_analysis_version > 0))));
