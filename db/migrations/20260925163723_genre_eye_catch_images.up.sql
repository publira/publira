-- A genre's eye-catch, stored the way a label's is: one genre_images row per
-- upload, one variant row per ratio and width, and the genre pointing at the
-- upload it shows.

-- TABLE: genre_images
CREATE TABLE genre_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    genre_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: genre_images genre_images_pkey
ALTER TABLE ONLY genre_images
    ADD CONSTRAINT genre_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: genre_images genre_images_tenant_id_id_key
ALTER TABLE ONLY genre_images
    ADD CONSTRAINT genre_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: genre_images genre_images_tenant_genre_id_fkey
ALTER TABLE ONLY genre_images
    ADD CONSTRAINT genre_images_tenant_genre_id_fkey FOREIGN KEY (tenant_id, genre_id) REFERENCES genres(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: genre_images genre_images_tenant_id_fkey
ALTER TABLE ONLY genre_images
    ADD CONSTRAINT genre_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_genre_images_genre_id
CREATE INDEX idx_genre_images_genre_id ON genre_images USING btree (genre_id);

-- INDEX: idx_genre_images_tenant_id
CREATE INDEX idx_genre_images_tenant_id ON genre_images USING btree (tenant_id);

-- ROW SECURITY: genre_images
ALTER TABLE genre_images ENABLE ROW LEVEL SECURITY;

-- POLICY: genre_images genre_images_tenant_isolation
CREATE POLICY genre_images_tenant_isolation ON genre_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: genre_image_variants
CREATE TABLE genre_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    genre_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    variant_type character varying(16) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT genre_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT genre_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT genre_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['portrait'::character varying, 'square'::character varying, 'landscape'::character varying, 'og'::character varying])::text[]))),
    CONSTRAINT genre_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: genre_image_variants genre_image_variants_pkey
ALTER TABLE ONLY genre_image_variants
    ADD CONSTRAINT genre_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: genre_image_variants genre_image_variants_tenant_genre_image_id_fkey
ALTER TABLE ONLY genre_image_variants
    ADD CONSTRAINT genre_image_variants_tenant_genre_image_id_fkey FOREIGN KEY (tenant_id, genre_image_id) REFERENCES genre_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: genre_image_variants genre_image_variants_tenant_id_fkey
ALTER TABLE ONLY genre_image_variants
    ADD CONSTRAINT genre_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_genre_image_variants_genre_image_id
CREATE INDEX idx_genre_image_variants_genre_image_id ON genre_image_variants USING btree (genre_image_id);

-- INDEX: idx_genre_image_variants_object_key
CREATE INDEX idx_genre_image_variants_object_key ON genre_image_variants USING btree (object_key);

-- INDEX: idx_genre_image_variants_tenant_id
CREATE INDEX idx_genre_image_variants_tenant_id ON genre_image_variants USING btree (tenant_id);

-- INDEX: uq_genre_image_variants_genre_image_type_width
CREATE UNIQUE INDEX uq_genre_image_variants_genre_image_type_width ON genre_image_variants USING btree (genre_image_id, variant_type, width);

-- ROW SECURITY: genre_image_variants
ALTER TABLE genre_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: genre_image_variants genre_image_variants_tenant_isolation
CREATE POLICY genre_image_variants_tenant_isolation ON genre_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: genres eye_catch_image_id
ALTER TABLE ONLY genres
    ADD COLUMN eye_catch_image_id uuid;

-- FK CONSTRAINT: genres genres_tenant_eye_catch_image_id_fkey
-- Deleting an image leaves the genre without an eye-catch rather than
-- pointing at nothing. Only the reference is nulled: tenant_id is NOT NULL.
ALTER TABLE ONLY genres
    ADD CONSTRAINT genres_tenant_eye_catch_image_id_fkey FOREIGN KEY (tenant_id, eye_catch_image_id) REFERENCES genre_images(tenant_id, id) ON DELETE SET NULL (eye_catch_image_id);
