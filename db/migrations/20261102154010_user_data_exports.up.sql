-- A reader's download of what the install keeps about them: the request, the
-- archive the worker builds for it in the bucket, and the limit on how often
-- one reader may ask.
--
-- The table and the policy columns are new, so nothing here rewrites a row a
-- running deployment writes to. The category constraint is replaced NOT VALID
-- and validated by the next migration, for the reason 20261021202116 gives.

-- TABLE: user_data_exports
-- One request for one reader's archive. requested_at is when the reader asked
-- for it. claimed_at is when a worker last took it up, and a claim that grows
-- old without a result is the claim of a worker that died mid-build, which
-- another worker takes over. ready_at is when the archive was stored, under
-- object_key, size_bytes long; failed_at is when the build gave up, which it
-- does only when there is no object store to write to. expires_at is when
-- the row, and the archive with it, is purged: set when the request is ready
-- or failed, and never before.
--
-- user_id is NULL once the account is deleted. The row is then the purge's to
-- take, archive and all, on its next pass, rather than a cascade's: a cascade
-- would forget the key of an object the bucket still holds.
CREATE TABLE user_data_exports (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid,
    requested_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    ready_at timestamp with time zone,
    failed_at timestamp with time zone,
    expires_at timestamp with time zone,
    object_key text,
    size_bytes bigint,
    CONSTRAINT user_data_exports_result_check CHECK (((ready_at IS NULL) OR (failed_at IS NULL))),
    CONSTRAINT user_data_exports_archive_check CHECK ((((ready_at IS NULL) = (object_key IS NULL)) AND ((ready_at IS NULL) = (size_bytes IS NULL)))),
    CONSTRAINT user_data_exports_expires_at_check CHECK (((expires_at IS NULL) = ((ready_at IS NULL) AND (failed_at IS NULL)))),
    CONSTRAINT user_data_exports_object_key_check CHECK ((char_length(object_key) >= 1)),
    CONSTRAINT user_data_exports_size_bytes_check CHECK ((size_bytes >= 0))
);

-- CONSTRAINT: user_data_exports user_data_exports_pkey
ALTER TABLE ONLY user_data_exports
    ADD CONSTRAINT user_data_exports_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: user_data_exports user_data_exports_tenant_id_fkey
ALTER TABLE ONLY user_data_exports
    ADD CONSTRAINT user_data_exports_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_data_exports user_data_exports_tenant_user_id_fkey
-- Composite FK prevents referencing a user that belongs to another tenant. A
-- deleted account leaves the row for the purge, as the table's comment says.
ALTER TABLE ONLY user_data_exports
    ADD CONSTRAINT user_data_exports_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (user_id);

-- INDEX: idx_user_data_exports_open
-- One open request per reader: one the worker has neither built nor given up
-- on.
CREATE UNIQUE INDEX idx_user_data_exports_open ON user_data_exports USING btree (tenant_id, user_id)
    WHERE ((ready_at IS NULL) AND (failed_at IS NULL));

-- INDEX: idx_user_data_exports_tenant_user_requested_at
-- The reader's latest request, which is the one their account shows.
CREATE INDEX idx_user_data_exports_tenant_user_requested_at ON user_data_exports USING btree (tenant_id, user_id, requested_at);

-- INDEX: idx_user_data_exports_pending
-- What the worker looks for on every pass.
CREATE INDEX idx_user_data_exports_pending ON user_data_exports USING btree (requested_at)
    WHERE ((ready_at IS NULL) AND (failed_at IS NULL) AND (user_id IS NOT NULL));

-- INDEX: idx_user_data_exports_expires_at
-- What the purge takes because its time is up.
CREATE INDEX idx_user_data_exports_expires_at ON user_data_exports USING btree (expires_at)
    WHERE (expires_at IS NOT NULL);

-- INDEX: idx_user_data_exports_deleted_account
-- What the purge takes because its account is gone.
CREATE INDEX idx_user_data_exports_deleted_account ON user_data_exports USING btree (id)
    WHERE (user_id IS NULL);

-- INDEX: idx_user_data_exports_object_key
-- The orphan sweep's lookup of whether a stored object is an archive a row
-- still names.
CREATE INDEX idx_user_data_exports_object_key ON user_data_exports USING btree (object_key)
    WHERE (object_key IS NOT NULL);

-- ROW SECURITY: user_data_exports
ALTER TABLE user_data_exports ENABLE ROW LEVEL SECURITY;

-- POLICY: user_data_exports user_data_exports_member_isolation
-- The member isolation episode_reading_positions uses: the archive is
-- everything the install keeps about one reader, so tenant isolation alone
-- would let one member of the tenant read another's.
CREATE POLICY user_data_exports_member_isolation ON user_data_exports
    USING (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    )
    WITH CHECK (
        (tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)
        AND (user_id = (NULLIF(current_setting('app.current_user_id'::text, true), ''::text))::uuid)
    );

-- COLUMN: platform_policy_config data_export_limit_per_hour
-- COLUMN: platform_policy_config data_export_limit_per_day
-- How often one reader may ask AuthService.RequestMyDataExport for an archive.
-- Each request has the worker read every table that holds the reader's rows
-- and store the result in the bucket, so what this bounds is the load one
-- account can put on the database and the objects it can leave in the bucket.
-- Unlike most value columns these keep their defaults: the previous release's
-- insert does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN data_export_limit_per_hour integer DEFAULT 1 NOT NULL,
    ADD COLUMN data_export_limit_per_day integer DEFAULT 1 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_data_export_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_data_export_limit_check CHECK (((data_export_limit_per_hour >= 1) AND (data_export_limit_per_day >= data_export_limit_per_hour)));

-- COLUMN: notifications category
-- 'account' joins the categories: a row about the reader's own account that
-- they asked for, such as their archive being ready, which no preference
-- governs.
ALTER TABLE ONLY notifications
    DROP CONSTRAINT notifications_category_check,
    ADD CONSTRAINT notifications_category_check CHECK ((category = ANY (ARRAY['followed_episodes'::text, 'followed_creators'::text, 'comments'::text, 'announcements'::text, 'everyone'::text, 'staff'::text, 'account'::text]))) NOT VALID;
