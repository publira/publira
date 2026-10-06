-- The engine the public catalog searches find their hits through. The row is
-- absent until an operator saves one, and an absent row is the SQL engine,
-- which needs nothing beside the database.
--
-- The row holds two configurations. The saved one is what the operator last
-- asked for. The serving one is what the search answers from, and it trails
-- the saved one while the worker builds the index on a target the search has
-- not used before: until that index holds the catalog, the storefront keeps
-- answering from the previous target rather than from an empty index.
CREATE TABLE platform_search_config (
    singleton boolean DEFAULT true NOT NULL,
    -- 'sql' is a substring match in PostgreSQL and needs nothing else;
    -- 'opensearch' is a node of that engine with the analysis-kuromoji and
    -- analysis-icu plugins.
    engine text NOT NULL,
    -- The engine's http:// or https:// URL, without userinfo, and the alias
    -- of the index holding the catalog. Both NULL on 'sql', both set on any
    -- other engine.
    url text,
    index_alias text,
    -- HTTP basic auth, both NULL or both set. The password is encrypted under
    -- keys the database never holds.
    username text,
    password_encrypted text,
    -- Moves with every write, so a save can state which version it is based on.
    revision bigint DEFAULT 1 NOT NULL,
    -- The saved configuration the search answers from, and the revision it was
    -- saved at. Zero is the SQL engine of a row that has never served any
    -- other, which is what an install answers from before its first save.
    serving_revision bigint DEFAULT 0 NOT NULL,
    serving_engine text DEFAULT 'sql'::text NOT NULL,
    serving_url text,
    serving_index_alias text,
    serving_username text,
    serving_password_encrypted text,
    -- When the search moved onto the serving configuration, NULL until it
    -- first moves.
    serving_since timestamp with time zone,
    -- The last build that failed: the revision it was building, what went
    -- wrong, and when. A build that succeeds clears all three, and so does a
    -- save, which leaves nothing the failure is still about.
    build_failed_revision bigint,
    build_error text,
    build_failed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_search_config_singleton_check CHECK (singleton),
    CONSTRAINT platform_search_config_revision_positive_check CHECK ((revision > 0)),
    CONSTRAINT platform_search_config_engine_check CHECK ((engine = ANY (ARRAY['sql'::text, 'opensearch'::text]))),
    CONSTRAINT platform_search_config_target_check CHECK (((engine = 'sql'::text) = (url IS NULL)) AND ((url IS NULL) = (index_alias IS NULL))),
    CONSTRAINT platform_search_config_url_not_blank_check CHECK (((url IS NULL) OR (btrim(url) <> ''))),
    CONSTRAINT platform_search_config_index_alias_not_blank_check CHECK (((index_alias IS NULL) OR (btrim(index_alias) <> ''))),
    CONSTRAINT platform_search_config_credentials_check CHECK ((((username IS NULL) = (password_encrypted IS NULL)) AND ((username IS NULL) OR ((url IS NOT NULL) AND (btrim(username) <> '') AND (btrim(password_encrypted) <> ''))))),
    CONSTRAINT platform_search_config_serving_revision_check CHECK (((serving_revision >= 0) AND (serving_revision <= revision))),
    CONSTRAINT platform_search_config_serving_engine_check CHECK ((serving_engine = ANY (ARRAY['sql'::text, 'opensearch'::text]))),
    CONSTRAINT platform_search_config_serving_target_check CHECK (((serving_engine = 'sql'::text) = (serving_url IS NULL)) AND ((serving_url IS NULL) = (serving_index_alias IS NULL))),
    CONSTRAINT platform_search_config_serving_credentials_check CHECK (((serving_username IS NULL) = (serving_password_encrypted IS NULL))),
    CONSTRAINT platform_search_config_build_failure_check CHECK ((((build_failed_revision IS NULL) = (build_error IS NULL)) AND ((build_error IS NULL) = (build_failed_at IS NULL))))
);

-- CONSTRAINT: platform_search_config platform_search_config_pkey
ALTER TABLE ONLY platform_search_config
    ADD CONSTRAINT platform_search_config_pkey PRIMARY KEY (singleton);
