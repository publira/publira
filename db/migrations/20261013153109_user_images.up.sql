-- The icon a reader shows as their identity. It has the shape a creator's icon
-- has: an image row the account owns, the stored variants under it, and a
-- column on the account electing the one in use. A replacement stores a new
-- image rather than overwriting the old object, so the URL a page holds
-- changes with it, and the image it replaced stays behind until the orphan
-- sweep finds nothing electing it.
--
-- The constraints on users are added NOT VALID so this file takes its ACCESS
-- EXCLUSIVE lock on users without scanning it; the next migration validates
-- them under a lock that lets sign-ups and sign-ins continue.

-- TABLE: user_images
CREATE TABLE user_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_images user_images_pkey
ALTER TABLE ONLY user_images
    ADD CONSTRAINT user_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: user_images user_images_tenant_id_id_key
-- Lets the variants and the account's election name the image together with
-- its tenant.
ALTER TABLE ONLY user_images
    ADD CONSTRAINT user_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: user_images user_images_tenant_user_id_fkey
-- An account that is deleted takes its images with it, which leaves their
-- objects to the orphan sweep.
ALTER TABLE ONLY user_images
    ADD CONSTRAINT user_images_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_images user_images_tenant_id_fkey
ALTER TABLE ONLY user_images
    ADD CONSTRAINT user_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_user_images_user_id
CREATE INDEX idx_user_images_user_id ON user_images USING btree (user_id);

-- INDEX: idx_user_images_tenant_id
CREATE INDEX idx_user_images_tenant_id ON user_images USING btree (tenant_id);

-- ROW SECURITY: user_images
ALTER TABLE user_images ENABLE ROW LEVEL SECURITY;

-- POLICY: user_images user_images_tenant_isolation
CREATE POLICY user_images_tenant_isolation ON user_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_image_variants
CREATE TABLE user_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT user_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT user_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: user_image_variants user_image_variants_pkey
ALTER TABLE ONLY user_image_variants
    ADD CONSTRAINT user_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: user_image_variants user_image_variants_tenant_user_image_id_fkey
ALTER TABLE ONLY user_image_variants
    ADD CONSTRAINT user_image_variants_tenant_user_image_id_fkey FOREIGN KEY (tenant_id, user_image_id) REFERENCES user_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_image_variants user_image_variants_tenant_id_fkey
ALTER TABLE ONLY user_image_variants
    ADD CONSTRAINT user_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_user_image_variants_user_image_id
CREATE INDEX idx_user_image_variants_user_image_id ON user_image_variants USING btree (user_image_id);

-- INDEX: idx_user_image_variants_object_key
-- The orphan sweep asks whether any variant names a stored object.
CREATE INDEX idx_user_image_variants_object_key ON user_image_variants USING btree (object_key);

-- INDEX: idx_user_image_variants_tenant_id
CREATE INDEX idx_user_image_variants_tenant_id ON user_image_variants USING btree (tenant_id);

-- ROW SECURITY: user_image_variants
ALTER TABLE user_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: user_image_variants user_image_variants_tenant_isolation
CREATE POLICY user_image_variants_tenant_isolation ON user_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: users icon_image_id
-- The account's icon, or NULL for an account that shows none. Removing the
-- image row clears only this column: tenant_id is the other half of the key
-- and is what places the account in its tenant.
ALTER TABLE ONLY users
    ADD COLUMN icon_image_id uuid;

-- FK CONSTRAINT: users users_tenant_icon_image_id_fkey
ALTER TABLE ONLY users
    ADD CONSTRAINT users_tenant_icon_image_id_fkey FOREIGN KEY (tenant_id, icon_image_id) REFERENCES user_images(tenant_id, id) ON DELETE SET NULL (icon_image_id) NOT VALID;

-- CONSTRAINT: users users_icon_image_id_tenant_check
-- An account with no tenant has no tenant to file an icon under, and the
-- foreign key above is not checked at all while tenant_id is NULL, so it is
-- refused one here rather than left free to name any image.
ALTER TABLE ONLY users
    ADD CONSTRAINT users_icon_image_id_tenant_check CHECK (((icon_image_id IS NULL) OR (tenant_id IS NOT NULL))) NOT VALID;
