-- What a tenant lets a reader show as an icon: an upload of their own, one of a
-- set of icons the tenant provides, or none at all. The tenant's set is stored
-- the way a reader's upload is — a row with its stored variants under it — and
-- an account elects a preset through a column of its own, beside the one that
-- elects an upload.
--
-- The constraints on users are added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE lock on users without scanning it; the next migration validates
-- them under a lock that lets sign-ups and sign-ins continue.

-- COLUMN: tenant_config reader_icon_policy
-- `upload` is what every tenant offered before the column existed, so it is
-- the default: a tenant upgrading must not find its readers' icons cleared.
ALTER TABLE tenant_config
    ADD COLUMN reader_icon_policy text DEFAULT 'upload'::text NOT NULL;

ALTER TABLE tenant_config
    ADD CONSTRAINT tenant_config_reader_icon_policy_check CHECK ((reader_icon_policy = ANY (ARRAY['upload'::text, 'preset'::text, 'disabled'::text])));

-- TABLE: reader_icon_presets
CREATE TABLE reader_icon_presets (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: reader_icon_presets reader_icon_presets_pkey
ALTER TABLE ONLY reader_icon_presets
    ADD CONSTRAINT reader_icon_presets_pkey PRIMARY KEY (id);

-- CONSTRAINT: reader_icon_presets reader_icon_presets_tenant_id_id_key
-- Lets the variants and an account's election name the preset together with
-- its tenant.
ALTER TABLE ONLY reader_icon_presets
    ADD CONSTRAINT reader_icon_presets_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: reader_icon_presets reader_icon_presets_tenant_id_fkey
ALTER TABLE ONLY reader_icon_presets
    ADD CONSTRAINT reader_icon_presets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: reader_icon_presets
ALTER TABLE reader_icon_presets ENABLE ROW LEVEL SECURITY;

-- POLICY: reader_icon_presets reader_icon_presets_tenant_isolation
CREATE POLICY reader_icon_presets_tenant_isolation ON reader_icon_presets USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: reader_icon_preset_variants
CREATE TABLE reader_icon_preset_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    reader_icon_preset_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT reader_icon_preset_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT reader_icon_preset_variants_height_check CHECK ((height > 0)),
    CONSTRAINT reader_icon_preset_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: reader_icon_preset_variants reader_icon_preset_variants_pkey
ALTER TABLE ONLY reader_icon_preset_variants
    ADD CONSTRAINT reader_icon_preset_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: reader_icon_preset_variants reader_icon_preset_variants_tenant_preset_id_fkey
-- Deleting a preset takes its variants with it, which leaves their objects to
-- the orphan sweep.
ALTER TABLE ONLY reader_icon_preset_variants
    ADD CONSTRAINT reader_icon_preset_variants_tenant_preset_id_fkey FOREIGN KEY (tenant_id, reader_icon_preset_id) REFERENCES reader_icon_presets(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: reader_icon_preset_variants reader_icon_preset_variants_tenant_id_fkey
ALTER TABLE ONLY reader_icon_preset_variants
    ADD CONSTRAINT reader_icon_preset_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_reader_icon_preset_variants_preset_id
CREATE INDEX idx_reader_icon_preset_variants_preset_id ON reader_icon_preset_variants USING btree (reader_icon_preset_id);

-- INDEX: idx_reader_icon_preset_variants_object_key
-- The orphan sweep asks whether any variant names a stored object.
CREATE INDEX idx_reader_icon_preset_variants_object_key ON reader_icon_preset_variants USING btree (object_key);

-- INDEX: idx_reader_icon_preset_variants_tenant_id
CREATE INDEX idx_reader_icon_preset_variants_tenant_id ON reader_icon_preset_variants USING btree (tenant_id);

-- ROW SECURITY: reader_icon_preset_variants
ALTER TABLE reader_icon_preset_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: reader_icon_preset_variants reader_icon_preset_variants_tenant_isolation
CREATE POLICY reader_icon_preset_variants_tenant_isolation ON reader_icon_preset_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: users icon_preset_id
-- The tenant's preset the account shows as its icon, or NULL. Deleting the
-- preset clears only this column, which leaves the account with no icon:
-- tenant_id is the other half of the key and is what places the account in
-- its tenant.
ALTER TABLE ONLY users
    ADD COLUMN icon_preset_id uuid;

-- FK CONSTRAINT: users users_tenant_icon_preset_id_fkey
ALTER TABLE ONLY users
    ADD CONSTRAINT users_tenant_icon_preset_id_fkey FOREIGN KEY (tenant_id, icon_preset_id) REFERENCES reader_icon_presets(tenant_id, id) ON DELETE SET NULL (icon_preset_id) NOT VALID;

-- CONSTRAINT: users users_icon_preset_id_tenant_check
-- The foreign key above is not checked at all while tenant_id is NULL, so an
-- account with no tenant is refused a preset here, as it is an upload.
ALTER TABLE ONLY users
    ADD CONSTRAINT users_icon_preset_id_tenant_check CHECK (((icon_preset_id IS NULL) OR (tenant_id IS NOT NULL))) NOT VALID;

-- CONSTRAINT: users users_one_icon_check
-- An account shows one icon: electing an upload clears the preset, and
-- electing a preset clears the upload.
ALTER TABLE ONLY users
    ADD CONSTRAINT users_one_icon_check CHECK (((icon_image_id IS NULL) OR (icon_preset_id IS NULL))) NOT VALID;
