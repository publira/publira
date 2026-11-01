-- TABLE: volume_bookstore_links
-- Where a volume's printed edition is sold, in the order the series page lists
-- the links. A link is the words its button says and an https URL, and
-- nothing else: the tenant names the bookstore itself.
--
-- The links are a table of their own rather than a column on volumes, written
-- by an RPC of their own, so the previous release's console replacing a
-- volume's title and price does not clear them.
CREATE TABLE volume_bookstore_links (
    tenant_id uuid NOT NULL,
    volume_id uuid NOT NULL,
    "position" integer NOT NULL,
    label text NOT NULL,
    url text NOT NULL,
    CONSTRAINT volume_bookstore_links_position_check CHECK (("position" >= 0)),
    CONSTRAINT volume_bookstore_links_label_check CHECK (((char_length(label) >= 1) AND (char_length(label) <= 50))),
    CONSTRAINT volume_bookstore_links_url_check CHECK (((url ~~ 'https://%'::text) AND (char_length(url) <= 2048)))
);

-- CONSTRAINT: volume_bookstore_links volume_bookstore_links_pkey
ALTER TABLE ONLY volume_bookstore_links
    ADD CONSTRAINT volume_bookstore_links_pkey PRIMARY KEY (volume_id, "position");

-- FK CONSTRAINT: volume_bookstore_links volume_bookstore_links_tenant_id_fkey
ALTER TABLE ONLY volume_bookstore_links
    ADD CONSTRAINT volume_bookstore_links_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: volume_bookstore_links volume_bookstore_links_tenant_volume_id_fkey
ALTER TABLE ONLY volume_bookstore_links
    ADD CONSTRAINT volume_bookstore_links_tenant_volume_id_fkey FOREIGN KEY (tenant_id, volume_id) REFERENCES volumes(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_volume_bookstore_links_tenant_volume_position
-- A volume's links in its own order, and the composite foreign key to it.
CREATE INDEX idx_volume_bookstore_links_tenant_volume_position ON volume_bookstore_links USING btree (tenant_id, volume_id, "position");

-- ROW SECURITY: volume_bookstore_links
ALTER TABLE volume_bookstore_links ENABLE ROW LEVEL SECURITY;

-- POLICY: volume_bookstore_links volume_bookstore_links_tenant_isolation
CREATE POLICY volume_bookstore_links_tenant_isolation ON volume_bookstore_links USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
