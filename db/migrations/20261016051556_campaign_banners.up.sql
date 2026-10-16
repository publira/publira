-- Campaign banners: an image the tenant schedules at the top of its storefront
-- and the app's catalog for a window of time, linking wherever the operator
-- points it. The image is stored the way a genre's eye-catch is: one
-- campaign_banner_images row per upload, one variant row per ratio and width,
-- and the banner pointing at the upload it shows.

-- TABLE: campaign_banners
-- Both ends of the window are absolute instants, as a free window's are: an
-- operator picks them in the tenant's own time zone and the console converts,
-- so a banner that comes down "Sunday midnight" comes down at the same moment
-- for every reader wherever they are.
--
-- An expired banner stays until someone deletes it, so the console can
-- schedule the same campaign again from it. The admin API caps how many one
-- tenant holds, which is what lets every list of them go unpaged.
CREATE TABLE campaign_banners (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    -- A path on the tenant's own site or an absolute http(s) URL. The admin
    -- API checks the shape; the length bound is here so nothing longer than a
    -- browser keeps in its address bar is ever stored.
    link_url text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    display_order integer NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    image_id uuid,
    -- When the site caches were dropped for each end of the window. NULL means
    -- that boundary has not been applied yet, so a ticker that was down over a
    -- boundary still catches up on its next pass instead of leaving a closed
    -- banner served from cache. A save sets both itself, because the save
    -- already drops the caches for a boundary it stores in the past.
    start_revalidated_at timestamp with time zone,
    end_revalidated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Half-open [starts_at, ends_at): the end instant is already outside the
    -- window, which is what lets one campaign hand over to the next.
    CONSTRAINT campaign_banners_period_check CHECK ((ends_at > starts_at)),
    CONSTRAINT campaign_banners_link_url_check CHECK (((char_length(link_url) >= 1) AND (char_length(link_url) <= 2048)))
);

-- CONSTRAINT: campaign_banners campaign_banners_pkey
ALTER TABLE ONLY campaign_banners
    ADD CONSTRAINT campaign_banners_pkey PRIMARY KEY (id);

-- CONSTRAINT: campaign_banners campaign_banners_tenant_id_id_key
-- Lets the images name the banner together with its tenant.
ALTER TABLE ONLY campaign_banners
    ADD CONSTRAINT campaign_banners_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: campaign_banners campaign_banners_tenant_public_id_key
ALTER TABLE ONLY campaign_banners
    ADD CONSTRAINT campaign_banners_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- FK CONSTRAINT: campaign_banners campaign_banners_tenant_id_fkey
ALTER TABLE ONLY campaign_banners
    ADD CONSTRAINT campaign_banners_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_campaign_banners_tenant_display_order
-- Every read of a tenant's banners, the console's and the storefront's, is in
-- the order the console put them in.
CREATE INDEX idx_campaign_banners_tenant_display_order ON campaign_banners USING btree (tenant_id, display_order, id);

-- INDEX: idx_campaign_banners_pending_boundaries
-- The ticker job that drops the site caches at a boundary reads only the rows
-- with a boundary it has not applied yet, so the partial index stays about as
-- small as that work queue.
CREATE INDEX idx_campaign_banners_pending_boundaries ON campaign_banners USING btree (starts_at, ends_at)
    WHERE ((start_revalidated_at IS NULL) OR (end_revalidated_at IS NULL));

-- ROW SECURITY: campaign_banners
ALTER TABLE campaign_banners ENABLE ROW LEVEL SECURITY;

-- POLICY: campaign_banners campaign_banners_tenant_isolation
CREATE POLICY campaign_banners_tenant_isolation ON campaign_banners USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: campaign_banner_images
CREATE TABLE campaign_banner_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    campaign_banner_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: campaign_banner_images campaign_banner_images_pkey
ALTER TABLE ONLY campaign_banner_images
    ADD CONSTRAINT campaign_banner_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: campaign_banner_images campaign_banner_images_tenant_id_id_key
ALTER TABLE ONLY campaign_banner_images
    ADD CONSTRAINT campaign_banner_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: campaign_banner_images campaign_banner_images_tenant_campaign_banner_id_fkey
ALTER TABLE ONLY campaign_banner_images
    ADD CONSTRAINT campaign_banner_images_tenant_campaign_banner_id_fkey FOREIGN KEY (tenant_id, campaign_banner_id) REFERENCES campaign_banners(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: campaign_banner_images campaign_banner_images_tenant_id_fkey
ALTER TABLE ONLY campaign_banner_images
    ADD CONSTRAINT campaign_banner_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_campaign_banner_images_campaign_banner_id
CREATE INDEX idx_campaign_banner_images_campaign_banner_id ON campaign_banner_images USING btree (campaign_banner_id);

-- INDEX: idx_campaign_banner_images_tenant_id
CREATE INDEX idx_campaign_banner_images_tenant_id ON campaign_banner_images USING btree (tenant_id);

-- ROW SECURITY: campaign_banner_images
ALTER TABLE campaign_banner_images ENABLE ROW LEVEL SECURITY;

-- POLICY: campaign_banner_images campaign_banner_images_tenant_isolation
CREATE POLICY campaign_banner_images_tenant_isolation ON campaign_banner_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: campaign_banner_image_variants
CREATE TABLE campaign_banner_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    campaign_banner_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    variant_type character varying(16) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT campaign_banner_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT campaign_banner_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT campaign_banner_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['portrait'::character varying, 'square'::character varying, 'landscape'::character varying, 'og'::character varying])::text[]))),
    CONSTRAINT campaign_banner_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: campaign_banner_image_variants campaign_banner_image_variants_pkey
ALTER TABLE ONLY campaign_banner_image_variants
    ADD CONSTRAINT campaign_banner_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: campaign_banner_image_variants campaign_banner_image_variants_tenant_image_id_fkey
ALTER TABLE ONLY campaign_banner_image_variants
    ADD CONSTRAINT campaign_banner_image_variants_tenant_image_id_fkey FOREIGN KEY (tenant_id, campaign_banner_image_id) REFERENCES campaign_banner_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: campaign_banner_image_variants campaign_banner_image_variants_tenant_id_fkey
ALTER TABLE ONLY campaign_banner_image_variants
    ADD CONSTRAINT campaign_banner_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_campaign_banner_image_variants_image_id
CREATE INDEX idx_campaign_banner_image_variants_image_id ON campaign_banner_image_variants USING btree (campaign_banner_image_id);

-- INDEX: idx_campaign_banner_image_variants_object_key
CREATE INDEX idx_campaign_banner_image_variants_object_key ON campaign_banner_image_variants USING btree (object_key);

-- INDEX: idx_campaign_banner_image_variants_tenant_id
CREATE INDEX idx_campaign_banner_image_variants_tenant_id ON campaign_banner_image_variants USING btree (tenant_id);

-- INDEX: uq_campaign_banner_image_variants_image_type_width
CREATE UNIQUE INDEX uq_campaign_banner_image_variants_image_type_width ON campaign_banner_image_variants USING btree (campaign_banner_image_id, variant_type, width);

-- ROW SECURITY: campaign_banner_image_variants
ALTER TABLE campaign_banner_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: campaign_banner_image_variants campaign_banner_image_variants_tenant_isolation
CREATE POLICY campaign_banner_image_variants_tenant_isolation ON campaign_banner_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FK CONSTRAINT: campaign_banners campaign_banners_tenant_image_id_fkey
-- Deleting an image leaves the banner without one rather than pointing at
-- nothing, and a banner without an image is never in the public answer. Only
-- the reference is nulled: tenant_id is NOT NULL.
ALTER TABLE ONLY campaign_banners
    ADD CONSTRAINT campaign_banners_tenant_image_id_fkey FOREIGN KEY (tenant_id, image_id) REFERENCES campaign_banner_images(tenant_id, id) ON DELETE SET NULL (image_id);
