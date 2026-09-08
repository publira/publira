-- Two ways into the catalog other than the alphabet: a classification the
-- tenant controls, and one it grows by using.
--
-- A genre is curated. An editor creates it, names it, and puts it where it
-- belongs in the list, so the set stays small enough to browse and the order
-- is the tenant's own. A tag is written on the series form and exists from
-- that moment; nothing manages it, and it goes away again once no series
-- carries it.
--
-- Both carry a slug, unique per tenant. It is the identity of the name rather
-- than a second name: two genres whose names differ only in case or spacing
-- collide on it, and a tag typed a second time with different capitalization
-- resolves to the row that already exists instead of splitting the catalog in
-- two. Genres also keep a public_id, because the console and the public
-- filters address a genre by an identifier a rename does not move.

-- TABLE: genres
CREATE TABLE genres (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: genres genres_pkey
ALTER TABLE ONLY genres
    ADD CONSTRAINT genres_pkey PRIMARY KEY (id);

-- CONSTRAINT: genres genres_public_id_key
ALTER TABLE ONLY genres
    ADD CONSTRAINT genres_public_id_key UNIQUE (public_id);

-- CONSTRAINT: genres genres_tenant_id_id_key
-- Enables composite FKs that keep child rows on the same tenant as the genre.
ALTER TABLE ONLY genres
    ADD CONSTRAINT genres_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: genres genres_tenant_id_fkey
ALTER TABLE ONLY genres
    ADD CONSTRAINT genres_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: uq_genres_tenant_slug
CREATE UNIQUE INDEX uq_genres_tenant_slug ON genres USING btree (tenant_id, slug);

-- INDEX: idx_genres_tenant_display_order
-- The genre list is read in the tenant's own order, and its cursor sorts on
-- the same (display_order, id) pair. Two genres can share a display_order, so
-- the id is what decides between them.
CREATE INDEX idx_genres_tenant_display_order ON genres USING btree (tenant_id, display_order, id);

-- ROW SECURITY: genres
ALTER TABLE genres ENABLE ROW LEVEL SECURITY;

-- POLICY: genres genres_tenant_isolation
CREATE POLICY genres_tenant_isolation ON genres USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tags
CREATE TABLE tags (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: tags tags_pkey
ALTER TABLE ONLY tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);

-- CONSTRAINT: tags tags_tenant_id_id_key
-- Enables composite FKs that keep child rows on the same tenant as the tag.
ALTER TABLE ONLY tags
    ADD CONSTRAINT tags_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: tags tags_tenant_id_fkey
ALTER TABLE ONLY tags
    ADD CONSTRAINT tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: uq_tags_tenant_slug
-- Also what the first use of a tag conflicts on: the series form inserts the
-- tag it was given and takes back whichever row holds the slug afterwards.
CREATE UNIQUE INDEX uq_tags_tenant_slug ON tags USING btree (tenant_id, slug);

-- ROW SECURITY: tags
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- POLICY: tags tags_tenant_isolation
CREATE POLICY tags_tenant_isolation ON tags USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_genres
CREATE TABLE series_genres (
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    genre_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: series_genres series_genres_pkey
ALTER TABLE ONLY series_genres
    ADD CONSTRAINT series_genres_pkey PRIMARY KEY (series_id, genre_id);

-- FK CONSTRAINT: series_genres series_genres_tenant_id_fkey
ALTER TABLE ONLY series_genres
    ADD CONSTRAINT series_genres_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_genres series_genres_tenant_series_id_fkey
ALTER TABLE ONLY series_genres
    ADD CONSTRAINT series_genres_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_genres series_genres_tenant_genre_id_fkey
-- No ON DELETE clause: a genre a series still carries is not something the
-- database drops on its own, which is what makes deleting a genre in use a
-- refusal the console can explain rather than a silent reclassification. The
-- default NO ACTION defers its check to the end of the statement, so a delete
-- that takes the assignment and the genre together still passes.
ALTER TABLE ONLY series_genres
    ADD CONSTRAINT series_genres_tenant_genre_id_fkey FOREIGN KEY (tenant_id, genre_id) REFERENCES genres(tenant_id, id);

-- INDEX: idx_series_genres_tenant_genre
-- Reads that start from the genre: the public list filtered by one genre, and
-- the check that refuses to delete a genre still in use. The primary key
-- starts at series_id and serves the other direction.
CREATE INDEX idx_series_genres_tenant_genre ON series_genres USING btree (tenant_id, genre_id, series_id);

-- ROW SECURITY: series_genres
ALTER TABLE series_genres ENABLE ROW LEVEL SECURITY;

-- POLICY: series_genres series_genres_tenant_isolation
CREATE POLICY series_genres_tenant_isolation ON series_genres USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: series_tags
CREATE TABLE series_tags (
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: series_tags series_tags_pkey
ALTER TABLE ONLY series_tags
    ADD CONSTRAINT series_tags_pkey PRIMARY KEY (series_id, tag_id);

-- FK CONSTRAINT: series_tags series_tags_tenant_id_fkey
ALTER TABLE ONLY series_tags
    ADD CONSTRAINT series_tags_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_tags series_tags_tenant_series_id_fkey
ALTER TABLE ONLY series_tags
    ADD CONSTRAINT series_tags_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_tags series_tags_tenant_tag_id_fkey
-- A tag is only as alive as the series carrying it, so this one cascades: the
-- series form deletes the tags its last series just let go of.
ALTER TABLE ONLY series_tags
    ADD CONSTRAINT series_tags_tenant_tag_id_fkey FOREIGN KEY (tenant_id, tag_id) REFERENCES tags(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_series_tags_tenant_tag
-- Reads that start from the tag: the public list filtered by one tag, and the
-- sweep that removes a tag no series carries any more.
CREATE INDEX idx_series_tags_tenant_tag ON series_tags USING btree (tenant_id, tag_id, series_id);

-- ROW SECURITY: series_tags
ALTER TABLE series_tags ENABLE ROW LEVEL SECURITY;

-- POLICY: series_tags series_tags_tenant_isolation
CREATE POLICY series_tags_tenant_isolation ON series_tags USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
