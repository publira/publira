-- COLUMN: platform_policy_config anonymous_read_public_api_limit_per_10_seconds
-- COLUMN: platform_policy_config anonymous_read_search_limit_per_10_seconds
-- COLUMN: platform_policy_config anonymous_read_images_limit_per_10_seconds
-- How many reads one client may make in 10 seconds of the public API but its
-- catalog search, of the catalog search procedures, and of the images of a
-- tenant's site and image hosts. The server enforces them behind the edge, so
-- an edge that limits nothing leaves an install less protected rather than
-- unprotected. Unlike most value columns these keep their defaults: the
-- previous release's insert does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN anonymous_read_public_api_limit_per_10_seconds integer DEFAULT 640 NOT NULL,
    ADD COLUMN anonymous_read_search_limit_per_10_seconds integer DEFAULT 80 NOT NULL,
    ADD COLUMN anonymous_read_images_limit_per_10_seconds integer DEFAULT 2400 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_anonymous_read_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_anonymous_read_limit_check CHECK (((anonymous_read_public_api_limit_per_10_seconds >= 1) AND (anonymous_read_search_limit_per_10_seconds >= 1) AND (anonymous_read_images_limit_per_10_seconds >= 1)));
