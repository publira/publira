-- Catalog: Publishable content: labels, creators, series and episodes, with their
-- images and listing state.

-- TABLE: labels
CREATE TABLE labels (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    eye_catch_image_id uuid
);

-- CONSTRAINT: labels labels_pkey
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);

-- CONSTRAINT: labels labels_public_id_key
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_public_id_key UNIQUE (public_id);

-- FK CONSTRAINT: labels labels_tenant_id_fkey
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_labels_tenant_created_at
CREATE INDEX idx_labels_tenant_created_at ON labels USING btree (tenant_id, created_at DESC, id DESC);

-- ROW SECURITY: labels
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;

-- POLICY: labels labels_tenant_isolation
CREATE POLICY labels_tenant_isolation ON labels USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: label_images
CREATE TABLE label_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    label_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: label_images label_images_pkey
ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: label_images label_images_label_id_fkey
ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_label_id_fkey FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE;

-- FK CONSTRAINT: label_images label_images_tenant_id_fkey
ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_label_images_label_id
CREATE INDEX idx_label_images_label_id ON label_images USING btree (label_id);

-- INDEX: idx_label_images_tenant_id
CREATE INDEX idx_label_images_tenant_id ON label_images USING btree (tenant_id);

-- ROW SECURITY: label_images
ALTER TABLE label_images ENABLE ROW LEVEL SECURITY;

-- POLICY: label_images label_images_tenant_isolation
CREATE POLICY label_images_tenant_isolation ON label_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: label_image_variants
CREATE TABLE label_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    label_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    variant_type character varying(16) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT label_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT label_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT label_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['portrait'::character varying, 'square'::character varying, 'landscape'::character varying, 'og'::character varying])::text[]))),
    CONSTRAINT label_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: label_image_variants label_image_variants_pkey
ALTER TABLE ONLY label_image_variants
    ADD CONSTRAINT label_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: label_image_variants label_image_variants_label_image_id_fkey
ALTER TABLE ONLY label_image_variants
    ADD CONSTRAINT label_image_variants_label_image_id_fkey FOREIGN KEY (label_image_id) REFERENCES label_images(id) ON DELETE CASCADE;

-- FK CONSTRAINT: label_image_variants label_image_variants_tenant_id_fkey
ALTER TABLE ONLY label_image_variants
    ADD CONSTRAINT label_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_label_image_variants_label_image_id
CREATE INDEX idx_label_image_variants_label_image_id ON label_image_variants USING btree (label_image_id);

-- INDEX: idx_label_image_variants_object_key
CREATE INDEX idx_label_image_variants_object_key ON label_image_variants USING btree (object_key);

-- INDEX: idx_label_image_variants_tenant_id
CREATE INDEX idx_label_image_variants_tenant_id ON label_image_variants USING btree (tenant_id);

-- INDEX: uq_label_image_variants_label_image_type_width
CREATE UNIQUE INDEX uq_label_image_variants_label_image_type_width ON label_image_variants USING btree (label_image_id, variant_type, width);

-- ROW SECURITY: label_image_variants
ALTER TABLE label_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: label_image_variants label_image_variants_tenant_isolation
CREATE POLICY label_image_variants_tenant_isolation ON label_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: creators
CREATE TABLE creators (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    name text NOT NULL,
    profile_text text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    icon_image_id uuid
);

-- CONSTRAINT: creators creators_pkey
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_pkey PRIMARY KEY (id);

-- CONSTRAINT: creators creators_public_id_key
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_public_id_key UNIQUE (public_id);

-- CONSTRAINT: creators creators_tenant_id_id_key
-- Enables composite FKs that keep child rows on the same tenant as the creator.
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: creators creators_tenant_id_fkey
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_creators_tenant_created_at
CREATE INDEX idx_creators_tenant_created_at ON creators USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_creators_tenant_name
-- 公開著者一覧の cursor 用。並び替えキーと同じ (name, id) の組で張る。
-- btree は逆順にも走査できるので、この 1 本で名前昇順と前ページ用の降順の
-- 両方を索引順に取り出せる。
CREATE INDEX idx_creators_tenant_name ON creators USING btree (tenant_id, name, id);

-- ROW SECURITY: creators
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;

-- POLICY: creators creators_tenant_isolation
CREATE POLICY creators_tenant_isolation ON creators USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: creator_images
CREATE TABLE creator_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: creator_images creator_images_pkey
ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: creator_images creator_images_creator_id_fkey
ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_images creator_images_tenant_id_fkey
ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_creator_images_creator_id
CREATE INDEX idx_creator_images_creator_id ON creator_images USING btree (creator_id);

-- INDEX: idx_creator_images_tenant_id
CREATE INDEX idx_creator_images_tenant_id ON creator_images USING btree (tenant_id);

-- ROW SECURITY: creator_images
ALTER TABLE creator_images ENABLE ROW LEVEL SECURITY;

-- POLICY: creator_images creator_images_tenant_isolation
CREATE POLICY creator_images_tenant_isolation ON creator_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: creator_image_variants
CREATE TABLE creator_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creator_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT creator_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT creator_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT creator_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: creator_image_variants creator_image_variants_pkey
ALTER TABLE ONLY creator_image_variants
    ADD CONSTRAINT creator_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: creator_image_variants creator_image_variants_creator_image_id_fkey
ALTER TABLE ONLY creator_image_variants
    ADD CONSTRAINT creator_image_variants_creator_image_id_fkey FOREIGN KEY (creator_image_id) REFERENCES creator_images(id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_image_variants creator_image_variants_tenant_id_fkey
ALTER TABLE ONLY creator_image_variants
    ADD CONSTRAINT creator_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_creator_image_variants_creator_image_id
CREATE INDEX idx_creator_image_variants_creator_image_id ON creator_image_variants USING btree (creator_image_id);

-- INDEX: idx_creator_image_variants_object_key
CREATE INDEX idx_creator_image_variants_object_key ON creator_image_variants USING btree (object_key);

-- INDEX: idx_creator_image_variants_tenant_id
CREATE INDEX idx_creator_image_variants_tenant_id ON creator_image_variants USING btree (tenant_id);

-- ROW SECURITY: creator_image_variants
ALTER TABLE creator_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: creator_image_variants creator_image_variants_tenant_isolation
CREATE POLICY creator_image_variants_tenant_isolation ON creator_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series
CREATE TABLE series (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    label_id uuid,
    public_id character varying(12) NOT NULL,
    title text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    is_published boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    eye_catch_image_id uuid
);

-- CONSTRAINT: series series_pkey
ALTER TABLE ONLY series
    ADD CONSTRAINT series_pkey PRIMARY KEY (id);

-- CONSTRAINT: series series_public_id_key
ALTER TABLE ONLY series
    ADD CONSTRAINT series_public_id_key UNIQUE (public_id);

-- CONSTRAINT: series series_tenant_id_id_key
-- Enables composite FKs that keep child rows on the same tenant as the series.
ALTER TABLE ONLY series
    ADD CONSTRAINT series_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: series series_label_id_fkey
ALTER TABLE ONLY series
    ADD CONSTRAINT series_label_id_fkey FOREIGN KEY (label_id) REFERENCES labels(id);

-- FK CONSTRAINT: series series_tenant_id_fkey
ALTER TABLE ONLY series
    ADD CONSTRAINT series_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- INDEX: idx_series_tenant_created_at
CREATE INDEX idx_series_tenant_created_at ON series USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_series_tenant_id
CREATE INDEX idx_series_tenant_id ON series USING btree (tenant_id);

-- INDEX: idx_series_tenant_public_id
CREATE INDEX idx_series_tenant_public_id ON series USING btree (tenant_id, public_id);

-- INDEX: idx_series_tenant_published_at
-- 末尾の id は公開シリーズ一覧の cursor のタイブレーカー。btree は逆順にも走査
-- できるので、この 1 本で新しい順と古い順の両方が索引順に取り出せる。
CREATE INDEX idx_series_tenant_published_at ON series USING btree (tenant_id, is_published, published_at DESC, id DESC);

-- INDEX: idx_series_tenant_title
-- タイトル順の cursor 用。並び替えキーと同じ (title, id) の組で張る。
CREATE INDEX idx_series_tenant_title ON series USING btree (tenant_id, is_published, title, id);

-- INDEX: idx_series_tenant_label_title
-- GetPublishedLabelDetail の関連シリーズ。キーセットはタイトル順と同じ
-- (title, id) で、先頭に label_id を足してそのレーベルだけを索引順に取る。
-- SearchPublishedSeries は title / synopsis の ILIKE '%q%' なのでこの btree
-- には乗らない。テナント + is_published で絞ったうえで LIMIT が効くうちは
-- シーケンシャルで足り、pg_trgm の GIN は件数が増えて遅延が見えた時点で足す。
CREATE INDEX idx_series_tenant_label_title ON series USING btree (tenant_id, label_id, is_published, title, id);

-- ROW SECURITY: series
ALTER TABLE series ENABLE ROW LEVEL SECURITY;

-- POLICY: series series_tenant_isolation
CREATE POLICY series_tenant_isolation ON series USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_creators
CREATE TABLE series_creators (
    series_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    role character varying(50) NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    tenant_id uuid NOT NULL
);

-- CONSTRAINT: series_creators series_creators_pkey
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_pkey PRIMARY KEY (series_id, creator_id);

-- FK CONSTRAINT: series_creators fk_series_creators_tenant_id
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT fk_series_creators_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_creators series_creators_creator_id_fkey
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_creators series_creators_series_id_fkey
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

-- INDEX: idx_series_creators_tenant_creator
-- 著者から公開シリーズを辿る EXISTS / JOIN 用。PK は (series_id, creator_id)
-- なので creator_id からの検索には乗らない。
CREATE INDEX idx_series_creators_tenant_creator ON series_creators USING btree (tenant_id, creator_id);

-- INDEX: idx_series_creators_tenant_id
CREATE INDEX idx_series_creators_tenant_id ON series_creators USING btree (tenant_id);

-- ROW SECURITY: series_creators
ALTER TABLE series_creators ENABLE ROW LEVEL SECURITY;

-- POLICY: series_creators series_creators_tenant_isolation
CREATE POLICY series_creators_tenant_isolation ON series_creators USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_images
CREATE TABLE series_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: series_images series_images_pkey
ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: series_images series_images_series_id_fkey
ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_images series_images_tenant_id_fkey
ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_series_images_series_id
CREATE INDEX idx_series_images_series_id ON series_images USING btree (series_id);

-- INDEX: idx_series_images_tenant_id
CREATE INDEX idx_series_images_tenant_id ON series_images USING btree (tenant_id);

-- ROW SECURITY: series_images
ALTER TABLE series_images ENABLE ROW LEVEL SECURITY;

-- POLICY: series_images series_images_tenant_isolation
CREATE POLICY series_images_tenant_isolation ON series_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_image_variants
CREATE TABLE series_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    series_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    variant_type character varying(16) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT series_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT series_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT series_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['portrait'::character varying, 'square'::character varying, 'landscape'::character varying, 'og'::character varying])::text[]))),
    CONSTRAINT series_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: series_image_variants series_image_variants_pkey
ALTER TABLE ONLY series_image_variants
    ADD CONSTRAINT series_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: series_image_variants series_image_variants_series_image_id_fkey
ALTER TABLE ONLY series_image_variants
    ADD CONSTRAINT series_image_variants_series_image_id_fkey FOREIGN KEY (series_image_id) REFERENCES series_images(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_image_variants series_image_variants_tenant_id_fkey
ALTER TABLE ONLY series_image_variants
    ADD CONSTRAINT series_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_series_image_variants_series_image_id
CREATE INDEX idx_series_image_variants_series_image_id ON series_image_variants USING btree (series_image_id);

-- INDEX: idx_series_image_variants_object_key
CREATE INDEX idx_series_image_variants_object_key ON series_image_variants USING btree (object_key);

-- INDEX: idx_series_image_variants_tenant_id
CREATE INDEX idx_series_image_variants_tenant_id ON series_image_variants USING btree (tenant_id);

-- INDEX: uq_series_image_variants_series_image_type_width
CREATE UNIQUE INDEX uq_series_image_variants_series_image_type_width ON series_image_variants USING btree (series_image_id, variant_type, width);

-- ROW SECURITY: series_image_variants
ALTER TABLE series_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: series_image_variants series_image_variants_tenant_isolation
CREATE POLICY series_image_variants_tenant_isolation ON series_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_listings
CREATE TABLE series_listings (
    series_id uuid NOT NULL,
    synopsis text,
    reading_period_hours integer,
    is_published boolean DEFAULT false,
    published_at timestamp with time zone DEFAULT now(),
    tenant_id uuid NOT NULL
);

-- CONSTRAINT: series_listings series_listings_pkey
ALTER TABLE ONLY series_listings
    ADD CONSTRAINT series_listings_pkey PRIMARY KEY (series_id);

-- FK CONSTRAINT: series_listings fk_series_listings_tenant_id
ALTER TABLE ONLY series_listings
    ADD CONSTRAINT fk_series_listings_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_listings series_listings_series_id_fkey
ALTER TABLE ONLY series_listings
    ADD CONSTRAINT series_listings_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

-- INDEX: idx_series_listings_tenant_id
CREATE INDEX idx_series_listings_tenant_id ON series_listings USING btree (tenant_id);

-- ROW SECURITY: series_listings
ALTER TABLE series_listings ENABLE ROW LEVEL SECURITY;

-- POLICY: series_listings series_listings_tenant_isolation
CREATE POLICY series_listings_tenant_isolation ON series_listings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: episodes
CREATE TABLE episodes (
    id uuid NOT NULL,
    series_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    title text NOT NULL,
    order_index integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL
);

-- CONSTRAINT: episodes episodes_pkey
ALTER TABLE ONLY episodes
    ADD CONSTRAINT episodes_pkey PRIMARY KEY (id);

-- CONSTRAINT: episodes episodes_public_id_key
ALTER TABLE ONLY episodes
    ADD CONSTRAINT episodes_public_id_key UNIQUE (public_id);

-- CONSTRAINT: episodes episodes_tenant_id_id_key
-- Enables composite FKs that keep child rows on the same tenant as the episode.
ALTER TABLE ONLY episodes
    ADD CONSTRAINT episodes_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: episodes episodes_series_id_fkey
ALTER TABLE ONLY episodes
    ADD CONSTRAINT episodes_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id);

-- FK CONSTRAINT: episodes fk_episodes_tenant_id
ALTER TABLE ONLY episodes
    ADD CONSTRAINT fk_episodes_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_episodes_series_order_index
CREATE INDEX idx_episodes_series_order_index ON episodes USING btree (series_id, order_index, id);

-- INDEX: idx_episodes_tenant_id
CREATE INDEX idx_episodes_tenant_id ON episodes USING btree (tenant_id);

-- ROW SECURITY: episodes
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

-- POLICY: episodes episodes_tenant_isolation
CREATE POLICY episodes_tenant_isolation ON episodes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: episode_images
CREATE TABLE episode_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: episode_images episode_images_pkey
ALTER TABLE ONLY episode_images
    ADD CONSTRAINT episode_images_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: episode_images episode_images_episode_id_fkey
ALTER TABLE ONLY episode_images
    ADD CONSTRAINT episode_images_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_images episode_images_tenant_id_fkey
ALTER TABLE ONLY episode_images
    ADD CONSTRAINT episode_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_episode_images_episode_id
CREATE INDEX idx_episode_images_episode_id ON episode_images USING btree (episode_id, display_order);

-- INDEX: idx_episode_images_tenant_id
CREATE INDEX idx_episode_images_tenant_id ON episode_images USING btree (tenant_id);

-- ROW SECURITY: episode_images
ALTER TABLE episode_images ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_images episode_images_tenant_isolation
CREATE POLICY episode_images_tenant_isolation ON episode_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: episode_image_variants
CREATE TABLE episode_image_variants (
    id uuid NOT NULL,
    episode_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT episode_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT episode_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT episode_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: episode_image_variants episode_image_variants_pkey
ALTER TABLE ONLY episode_image_variants
    ADD CONSTRAINT episode_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: episode_image_variants episode_image_variants_episode_image_id_fkey
ALTER TABLE ONLY episode_image_variants
    ADD CONSTRAINT episode_image_variants_episode_image_id_fkey FOREIGN KEY (episode_image_id) REFERENCES episode_images(id) ON DELETE CASCADE;

-- INDEX: idx_episode_image_variants_episode_image_id
CREATE INDEX idx_episode_image_variants_episode_image_id ON episode_image_variants USING btree (episode_image_id);

-- INDEX: idx_episode_image_variants_object_key
CREATE INDEX idx_episode_image_variants_object_key ON episode_image_variants USING btree (object_key);

-- TABLE: episode_listings
CREATE TABLE episode_listings (
    episode_id uuid NOT NULL,
    price integer DEFAULT 0 NOT NULL,
    reading_period_hours integer,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    scheduled_at timestamp with time zone,
    published_at timestamp with time zone,
    tenant_id uuid NOT NULL,
    CONSTRAINT episode_listings_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'scheduled'::character varying, 'published'::character varying])::text[])))
);

-- CONSTRAINT: episode_listings episode_listings_pkey
ALTER TABLE ONLY episode_listings
    ADD CONSTRAINT episode_listings_pkey PRIMARY KEY (episode_id);

-- FK CONSTRAINT: episode_listings episode_listings_episode_id_fkey
ALTER TABLE ONLY episode_listings
    ADD CONSTRAINT episode_listings_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_listings fk_episode_listings_tenant_id
ALTER TABLE ONLY episode_listings
    ADD CONSTRAINT fk_episode_listings_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_episode_listings_status_scheduled
CREATE INDEX idx_episode_listings_status_scheduled ON episode_listings USING btree (status, scheduled_at);

-- INDEX: idx_episode_listings_tenant_id
CREATE INDEX idx_episode_listings_tenant_id ON episode_listings USING btree (tenant_id);

-- ROW SECURITY: episode_listings
ALTER TABLE episode_listings ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_listings episode_listings_tenant_isolation
CREATE POLICY episode_listings_tenant_isolation ON episode_listings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- Circular references inside this domain: these foreign keys are added
-- once every table above exists.

-- FK CONSTRAINT: labels labels_eye_catch_image_id_fkey
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_eye_catch_image_id_fkey FOREIGN KEY (eye_catch_image_id) REFERENCES label_images(id) ON DELETE SET NULL;

-- FK CONSTRAINT: creators creators_icon_image_id_fkey
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_icon_image_id_fkey FOREIGN KEY (icon_image_id) REFERENCES creator_images(id) ON DELETE SET NULL;

-- FK CONSTRAINT: series series_eye_catch_image_id_fkey
ALTER TABLE ONLY series
    ADD CONSTRAINT series_eye_catch_image_id_fkey FOREIGN KEY (eye_catch_image_id) REFERENCES series_images(id) ON DELETE SET NULL;
