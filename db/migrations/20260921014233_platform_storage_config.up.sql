-- The one object store the installation writes every stored object to. The row
-- is absent until an operator saves one, and that absence is the whole
-- "not configured" state: a half-filled configuration is refused before it
-- reaches the table, so a row that exists names a bucket that can be addressed.
CREATE TABLE platform_storage_config (
    singleton boolean DEFAULT true NOT NULL,
    bucket text NOT NULL,
    -- The region the requests are signed for. Stated even against a provider
    -- that ignores it, because SigV4 has no signature without one and the
    -- process environment is no longer where the value comes from.
    region text NOT NULL,
    -- NULL leaves the endpoint to the SDK's own resolver, which is what a
    -- bucket on AWS wants. A value is the address an S3-compatible store is
    -- reached on.
    endpoint text,
    force_path_style boolean DEFAULT false NOT NULL,
    -- Where a stored object is readable from, for whatever serves one
    -- directly. NULL leaves an object addressed as s3://bucket/key.
    public_base_url text,
    -- Both NULL means the credentials each process finds for itself: an
    -- instance role, a web identity token, the environment. Either column on
    -- its own is half a credential, which the check below refuses.
    access_key_id text,
    secret_access_key_encrypted text,
    -- Moves with every write, so a save can state which version it is based on.
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_storage_config_singleton_check CHECK (singleton),
    CONSTRAINT platform_storage_config_revision_positive_check CHECK ((revision > 0)),
    CONSTRAINT platform_storage_config_bucket_not_blank_check CHECK ((btrim(bucket) <> '')),
    CONSTRAINT platform_storage_config_region_not_blank_check CHECK ((btrim(region) <> '')),
    -- A blank optional column would be a third state beside "set" and "absent",
    -- and the two would mean the same thing to every reader.
    CONSTRAINT platform_storage_config_endpoint_not_blank_check CHECK (((endpoint IS NULL) OR (btrim(endpoint) <> ''))),
    CONSTRAINT platform_storage_config_public_base_url_not_blank_check CHECK (((public_base_url IS NULL) OR (btrim(public_base_url) <> ''))),
    CONSTRAINT platform_storage_config_credentials_check CHECK ((((access_key_id IS NULL) = (secret_access_key_encrypted IS NULL)) AND ((access_key_id IS NULL) OR ((btrim(access_key_id) <> '') AND (btrim(secret_access_key_encrypted) <> '')))))
);

-- CONSTRAINT: platform_storage_config platform_storage_config_pkey
ALTER TABLE ONLY platform_storage_config
    ADD CONSTRAINT platform_storage_config_pkey PRIMARY KEY (singleton);
