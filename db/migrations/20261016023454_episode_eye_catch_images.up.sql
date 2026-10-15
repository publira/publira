-- An episode's own eye-catch, stored the way a series' is: one
-- episode_eye_catch_images row per upload, one variant row per ratio and
-- width, and the episode pointing at the upload it shows. episode_images is
-- taken by the pages of the body, which is why these tables carry eye_catch in
-- their names.

-- TABLE: episode_eye_catch_images
CREATE TABLE episode_eye_catch_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: episode_eye_catch_images episode_eye_catch_images_pkey
ALTER TABLE ONLY episode_eye_catch_images
    ADD CONSTRAINT episode_eye_catch_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: episode_eye_catch_images episode_eye_catch_images_tenant_id_id_key
ALTER TABLE ONLY episode_eye_catch_images
    ADD CONSTRAINT episode_eye_catch_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: episode_eye_catch_images episode_eye_catch_images_tenant_episode_id_fkey
ALTER TABLE ONLY episode_eye_catch_images
    ADD CONSTRAINT episode_eye_catch_images_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_eye_catch_images episode_eye_catch_images_tenant_id_fkey
ALTER TABLE ONLY episode_eye_catch_images
    ADD CONSTRAINT episode_eye_catch_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_episode_eye_catch_images_episode_id
CREATE INDEX idx_episode_eye_catch_images_episode_id ON episode_eye_catch_images USING btree (episode_id);

-- INDEX: idx_episode_eye_catch_images_tenant_id
CREATE INDEX idx_episode_eye_catch_images_tenant_id ON episode_eye_catch_images USING btree (tenant_id);

-- ROW SECURITY: episode_eye_catch_images
ALTER TABLE episode_eye_catch_images ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_eye_catch_images episode_eye_catch_images_tenant_isolation
CREATE POLICY episode_eye_catch_images_tenant_isolation ON episode_eye_catch_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: episode_eye_catch_image_variants
CREATE TABLE episode_eye_catch_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    episode_eye_catch_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    variant_type character varying(16) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT episode_eye_catch_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT episode_eye_catch_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT episode_eye_catch_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['portrait'::character varying, 'square'::character varying, 'landscape'::character varying, 'og'::character varying])::text[]))),
    CONSTRAINT episode_eye_catch_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: episode_eye_catch_image_variants episode_eye_catch_image_variants_pkey
ALTER TABLE ONLY episode_eye_catch_image_variants
    ADD CONSTRAINT episode_eye_catch_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: episode_eye_catch_image_variants episode_eye_catch_image_variants_tenant_image_id_fkey
ALTER TABLE ONLY episode_eye_catch_image_variants
    ADD CONSTRAINT episode_eye_catch_image_variants_tenant_image_id_fkey FOREIGN KEY (tenant_id, episode_eye_catch_image_id) REFERENCES episode_eye_catch_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_eye_catch_image_variants episode_eye_catch_image_variants_tenant_id_fkey
ALTER TABLE ONLY episode_eye_catch_image_variants
    ADD CONSTRAINT episode_eye_catch_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_episode_eye_catch_image_variants_image_id
CREATE INDEX idx_episode_eye_catch_image_variants_image_id ON episode_eye_catch_image_variants USING btree (episode_eye_catch_image_id);

-- INDEX: idx_episode_eye_catch_image_variants_object_key
CREATE INDEX idx_episode_eye_catch_image_variants_object_key ON episode_eye_catch_image_variants USING btree (object_key);

-- INDEX: idx_episode_eye_catch_image_variants_tenant_id
CREATE INDEX idx_episode_eye_catch_image_variants_tenant_id ON episode_eye_catch_image_variants USING btree (tenant_id);

-- INDEX: uq_episode_eye_catch_image_variants_image_type_width
CREATE UNIQUE INDEX uq_episode_eye_catch_image_variants_image_type_width ON episode_eye_catch_image_variants USING btree (episode_eye_catch_image_id, variant_type, width);

-- ROW SECURITY: episode_eye_catch_image_variants
ALTER TABLE episode_eye_catch_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_eye_catch_image_variants episode_eye_catch_image_variants_tenant_isolation
CREATE POLICY episode_eye_catch_image_variants_tenant_isolation ON episode_eye_catch_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: episodes eye_catch_image_id
ALTER TABLE ONLY episodes
    ADD COLUMN eye_catch_image_id uuid;

-- FK CONSTRAINT: episodes episodes_tenant_eye_catch_image_id_fkey
-- Deleting an image leaves the episode without an eye-catch rather than
-- pointing at nothing. Only the reference is nulled: tenant_id is NOT NULL.
ALTER TABLE ONLY episodes
    ADD CONSTRAINT episodes_tenant_eye_catch_image_id_fkey FOREIGN KEY (tenant_id, eye_catch_image_id) REFERENCES episode_eye_catch_images(tenant_id, id) ON DELETE SET NULL (eye_catch_image_id);
