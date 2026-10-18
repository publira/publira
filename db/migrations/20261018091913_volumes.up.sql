-- Volumes: a run of a series' episodes the tenant sells as one, at a price of
-- its own. Buying one opens every episode in it. The cover is stored the way a
-- campaign banner's image is: one volume_cover_images row per upload, one
-- variant row per ratio and width, and the volume pointing at the upload it
-- shows.
--
-- The CHECK and the foreign key added to purchases are NOT VALID, so this file
-- takes its ACCESS EXCLUSIVE lock on that table without scanning it; the next
-- migration validates them under a lock that lets reads and writes go on.

-- TABLE: volumes
-- A volume is listed with its series in order_index order, as the series'
-- episodes are. Its price is in the minor unit of the tenant currency, as an
-- episode's is, and a volume is never free: an episode that should cost
-- nothing is made free itself.
--
-- published_at is the instant the volume was first put on sale, and stays
-- when it is taken off: it is what tells a volume someone may have started to
-- pay for from one nobody could have, and an episode never leaves a volume of
-- the first kind, since a checkout started while it was on sale can still
-- complete.
CREATE TABLE volumes (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    series_id uuid NOT NULL,
    title text NOT NULL,
    order_index integer NOT NULL,
    price integer NOT NULL,
    cover_image_id uuid,
    is_published boolean DEFAULT false NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volumes_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 255))),
    CONSTRAINT volumes_price_check CHECK ((price > 0)),
    CONSTRAINT volumes_published_check CHECK (((NOT is_published) OR (published_at IS NOT NULL)))
);

-- CONSTRAINT: volumes volumes_pkey
ALTER TABLE ONLY volumes
    ADD CONSTRAINT volumes_pkey PRIMARY KEY (id);

-- CONSTRAINT: volumes volumes_tenant_id_id_key
-- Lets the episodes, the covers, and the purchases name the volume together
-- with its tenant.
ALTER TABLE ONLY volumes
    ADD CONSTRAINT volumes_tenant_id_id_key UNIQUE (tenant_id, id);

-- CONSTRAINT: volumes volumes_tenant_public_id_key
ALTER TABLE ONLY volumes
    ADD CONSTRAINT volumes_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- FK CONSTRAINT: volumes volumes_tenant_id_fkey
ALTER TABLE ONLY volumes
    ADD CONSTRAINT volumes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: volumes volumes_tenant_series_id_fkey
ALTER TABLE ONLY volumes
    ADD CONSTRAINT volumes_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id);

-- INDEX: idx_volumes_series_order_index
-- Every read of a series' volumes, the console's and the storefront's, is in
-- the order the console put them in.
CREATE INDEX idx_volumes_series_order_index ON volumes USING btree (series_id, order_index, id);

-- INDEX: idx_volumes_tenant_series_id
-- Backs the composite foreign key to series.
CREATE INDEX idx_volumes_tenant_series_id ON volumes USING btree (tenant_id, series_id);

-- ROW SECURITY: volumes
ALTER TABLE volumes ENABLE ROW LEVEL SECURITY;

-- POLICY: volumes volumes_tenant_isolation
CREATE POLICY volumes_tenant_isolation ON volumes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: volume_episodes
-- The episodes a volume sells, in the order it lists them. An episode is in at
-- most one volume, so buying two volumes of a series never pays for the same
-- episode twice. The episode is of the volume's own series, which the admin
-- API checks.
CREATE TABLE volume_episodes (
    tenant_id uuid NOT NULL,
    volume_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    "position" integer NOT NULL,
    CONSTRAINT volume_episodes_position_check CHECK (("position" >= 0))
);

-- CONSTRAINT: volume_episodes volume_episodes_pkey
ALTER TABLE ONLY volume_episodes
    ADD CONSTRAINT volume_episodes_pkey PRIMARY KEY (volume_id, episode_id);

-- CONSTRAINT: volume_episodes volume_episodes_tenant_episode_id_key
-- An episode in at most one volume. It also answers which volume holds an
-- episode, which is how a purchase of the volume opens the episode.
ALTER TABLE ONLY volume_episodes
    ADD CONSTRAINT volume_episodes_tenant_episode_id_key UNIQUE (tenant_id, episode_id);

-- FK CONSTRAINT: volume_episodes volume_episodes_tenant_id_fkey
ALTER TABLE ONLY volume_episodes
    ADD CONSTRAINT volume_episodes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: volume_episodes volume_episodes_tenant_volume_id_fkey
ALTER TABLE ONLY volume_episodes
    ADD CONSTRAINT volume_episodes_tenant_volume_id_fkey FOREIGN KEY (tenant_id, volume_id) REFERENCES volumes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: volume_episodes volume_episodes_tenant_episode_id_fkey
-- An episode in a volume is not deleted out from under it, as one somebody
-- bought is not (purchases_tenant_episode_id_fkey): a purchase of the volume
-- opens what the volume holds, so the cascade would take the episode from its
-- buyers. NO ACTION rather than RESTRICT, so a tenant deleted as a whole takes
-- both rows in the one statement.
ALTER TABLE ONLY volume_episodes
    ADD CONSTRAINT volume_episodes_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id);

-- INDEX: idx_volume_episodes_tenant_volume_position
-- A volume's episodes in its own order, and the composite foreign key to it.
CREATE INDEX idx_volume_episodes_tenant_volume_position ON volume_episodes USING btree (tenant_id, volume_id, "position");

-- ROW SECURITY: volume_episodes
ALTER TABLE volume_episodes ENABLE ROW LEVEL SECURITY;

-- POLICY: volume_episodes volume_episodes_tenant_isolation
CREATE POLICY volume_episodes_tenant_isolation ON volume_episodes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: volume_cover_images
CREATE TABLE volume_cover_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    volume_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: volume_cover_images volume_cover_images_pkey
ALTER TABLE ONLY volume_cover_images
    ADD CONSTRAINT volume_cover_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: volume_cover_images volume_cover_images_tenant_id_id_key
ALTER TABLE ONLY volume_cover_images
    ADD CONSTRAINT volume_cover_images_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: volume_cover_images volume_cover_images_tenant_volume_id_fkey
ALTER TABLE ONLY volume_cover_images
    ADD CONSTRAINT volume_cover_images_tenant_volume_id_fkey FOREIGN KEY (tenant_id, volume_id) REFERENCES volumes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: volume_cover_images volume_cover_images_tenant_id_fkey
ALTER TABLE ONLY volume_cover_images
    ADD CONSTRAINT volume_cover_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_volume_cover_images_tenant_volume_id
CREATE INDEX idx_volume_cover_images_tenant_volume_id ON volume_cover_images USING btree (tenant_id, volume_id);

-- ROW SECURITY: volume_cover_images
ALTER TABLE volume_cover_images ENABLE ROW LEVEL SECURITY;

-- POLICY: volume_cover_images volume_cover_images_tenant_isolation
CREATE POLICY volume_cover_images_tenant_isolation ON volume_cover_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: volume_cover_image_variants
CREATE TABLE volume_cover_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    volume_cover_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    variant_type character varying(16) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT volume_cover_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT volume_cover_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT volume_cover_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['portrait'::character varying, 'square'::character varying, 'landscape'::character varying, 'og'::character varying])::text[]))),
    CONSTRAINT volume_cover_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: volume_cover_image_variants volume_cover_image_variants_pkey
ALTER TABLE ONLY volume_cover_image_variants
    ADD CONSTRAINT volume_cover_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: volume_cover_image_variants volume_cover_image_variants_tenant_image_id_fkey
ALTER TABLE ONLY volume_cover_image_variants
    ADD CONSTRAINT volume_cover_image_variants_tenant_image_id_fkey FOREIGN KEY (tenant_id, volume_cover_image_id) REFERENCES volume_cover_images(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: volume_cover_image_variants volume_cover_image_variants_tenant_id_fkey
ALTER TABLE ONLY volume_cover_image_variants
    ADD CONSTRAINT volume_cover_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_volume_cover_image_variants_tenant_image_id
CREATE INDEX idx_volume_cover_image_variants_tenant_image_id ON volume_cover_image_variants USING btree (tenant_id, volume_cover_image_id);

-- INDEX: idx_volume_cover_image_variants_object_key
CREATE INDEX idx_volume_cover_image_variants_object_key ON volume_cover_image_variants USING btree (object_key);

-- INDEX: uq_volume_cover_image_variants_image_type_width
CREATE UNIQUE INDEX uq_volume_cover_image_variants_image_type_width ON volume_cover_image_variants USING btree (volume_cover_image_id, variant_type, width);

-- ROW SECURITY: volume_cover_image_variants
ALTER TABLE volume_cover_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: volume_cover_image_variants volume_cover_image_variants_tenant_isolation
CREATE POLICY volume_cover_image_variants_tenant_isolation ON volume_cover_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FK CONSTRAINT: volumes volumes_tenant_cover_image_id_fkey
-- Deleting a cover leaves the volume without one rather than pointing at
-- nothing. Only the reference is nulled: tenant_id is NOT NULL.
ALTER TABLE ONLY volumes
    ADD CONSTRAINT volumes_tenant_cover_image_id_fkey FOREIGN KEY (tenant_id, cover_image_id) REFERENCES volume_cover_images(tenant_id, id) ON DELETE SET NULL (cover_image_id);

-- TABLE: expired_volume_checkouts
-- The checkout a reader last let expire on a volume, which the next
-- checkout's idempotency key names, as expired_checkouts is for an episode.
CREATE TABLE expired_volume_checkouts (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    volume_id uuid NOT NULL,
    provider text NOT NULL,
    provider_checkout_id text NOT NULL,
    expired_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: expired_volume_checkouts expired_volume_checkouts_pkey
ALTER TABLE ONLY expired_volume_checkouts
    ADD CONSTRAINT expired_volume_checkouts_pkey PRIMARY KEY (tenant_id, user_id, volume_id);

-- FK CONSTRAINT: expired_volume_checkouts expired_volume_checkouts_tenant_id_fkey
ALTER TABLE ONLY expired_volume_checkouts
    ADD CONSTRAINT expired_volume_checkouts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: expired_volume_checkouts expired_volume_checkouts_tenant_user_id_fkey
ALTER TABLE ONLY expired_volume_checkouts
    ADD CONSTRAINT expired_volume_checkouts_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: expired_volume_checkouts expired_volume_checkouts_tenant_volume_id_fkey
ALTER TABLE ONLY expired_volume_checkouts
    ADD CONSTRAINT expired_volume_checkouts_tenant_volume_id_fkey FOREIGN KEY (tenant_id, volume_id) REFERENCES volumes(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_expired_volume_checkouts_tenant_volume_id
CREATE INDEX idx_expired_volume_checkouts_tenant_volume_id ON expired_volume_checkouts USING btree (tenant_id, volume_id);

-- ROW SECURITY: expired_volume_checkouts
ALTER TABLE expired_volume_checkouts ENABLE ROW LEVEL SECURITY;

-- POLICY: expired_volume_checkouts expired_volume_checkouts_tenant_isolation
CREATE POLICY expired_volume_checkouts_tenant_isolation ON expired_volume_checkouts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: purchases volume_id
-- What a purchase bought is one episode or one volume, never both and never
-- neither, so episode_id is no longer required. A volume is sold once and for
-- good: it is never rented, and no store sells it.
ALTER TABLE ONLY purchases
    ALTER COLUMN episode_id DROP NOT NULL,
    ADD COLUMN volume_id uuid,
    ADD CONSTRAINT purchases_item_check CHECK ((((episode_id IS NULL) <> (volume_id IS NULL)) AND ((volume_id IS NULL) OR ((kind = 'purchase'::text) AND (store IS NULL))))) NOT VALID,
    ADD CONSTRAINT purchases_tenant_volume_id_fkey FOREIGN KEY (tenant_id, volume_id) REFERENCES volumes(tenant_id, id) NOT VALID;

-- VIEW: episode_content_grants
-- A purchase of a volume grants every episode the volume holds now, as a
-- purchase of the episode itself would, which is what reports it as a
-- purchase to the reader. The admin API refuses to take an episode out of a
-- volume someone has bought, so what a buyer paid for stays in it.
--
-- The access tickets come first because purchases.episode_id is no longer NOT
-- NULL, and sqlc reads whether a column of a UNION may be NULL from its first
-- branch: led by the tickets, episode_id stays a plain uuid to every query
-- that filters on it, as it is in every row this view answers.
CREATE OR REPLACE VIEW episode_content_grants WITH (security_invoker = true) AS
SELECT at.tenant_id,
    at.user_id,
    at.episode_id,
    'access_ticket'::text AS kind,
    NULL::text AS purchase_kind
FROM access_tickets at
WHERE at.revoked_at IS NULL
    AND (
        at.expires_at IS NULL
        OR at.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    p.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
WHERE p.episode_id IS NOT NULL
    AND p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT p.tenant_id,
    p.user_id,
    ve.episode_id,
    'purchase'::text AS kind,
    p.kind AS purchase_kind
FROM purchases p
    JOIN volume_episodes ve ON ve.tenant_id = p.tenant_id
    AND ve.volume_id = p.volume_id
WHERE p.revoked_at IS NULL
    AND (
        p.expires_at IS NULL
        OR p.expires_at > NOW()
    )
UNION ALL
SELECT ec.tenant_id,
    ca.user_id,
    ec.episode_id,
    'creator'::text AS kind,
    NULL::text AS purchase_kind
FROM episode_creators ec
    JOIN creator_accounts ca ON ca.tenant_id = ec.tenant_id
    AND ca.creator_id = ec.creator_id;

-- VIEW: volume_purchase_surfaces
-- The surfaces a volume may be bought on: those every one of its episodes may
-- be bought on, by the purchase availability each resolves to. A purchase of
-- the volume is the permanent copy of each episode, so selling it where one of
-- them is not sold would sell that episode there. The series page lists and
-- the checkout sells a volume by this one answer.
CREATE VIEW volume_purchase_surfaces WITH (security_invoker = true) AS
SELECT v.id AS volume_id,
    v.tenant_id,
    s.surface
FROM volumes v
    CROSS JOIN unnest(ARRAY['web'::text, 'app'::text]) AS s(surface)
WHERE NOT EXISTS (
        SELECT 1
        FROM volume_episodes ve
            JOIN episode_purchase_availability epa ON epa.episode_id = ve.episode_id
        WHERE ve.tenant_id = v.tenant_id
            AND ve.volume_id = v.id
            AND epa.purchase_availability <> ALL (ARRAY['all'::text, s.surface])
    );
