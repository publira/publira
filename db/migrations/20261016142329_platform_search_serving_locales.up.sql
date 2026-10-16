-- The languages the serving configuration keeps a catalog index for, one index
-- each behind an alias named after the saved alias and the language. NULL on
-- 'sql', which keeps no index, and on an index built before the catalog was
-- indexed per language: the one index behind the alias itself, whose series
-- carry the text of their tenant's default language. The server searches the
-- indices this names, and builds a new set whenever it names other languages
-- than the server searches in, so an install serving the older index moves
-- onto per-language indices with the search answering from the index it has
-- until they are built.
ALTER TABLE platform_search_config
    ADD COLUMN serving_locales text[],
    ADD CONSTRAINT platform_search_config_serving_locales_check CHECK (((serving_locales IS NULL) OR ((serving_engine <> 'sql'::text) AND (cardinality(serving_locales) > 0) AND (array_position(serving_locales, NULL::text) IS NULL))));
