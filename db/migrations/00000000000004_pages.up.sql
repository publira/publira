-- Pages: Tenant-authored static pages and their version history.

-- TABLE: pages
CREATE TABLE pages (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    slug character varying(255) NOT NULL,
    title text NOT NULL,
    published_version_id uuid,
    display_in_footer boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: pages pages_pkey
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);

-- CONSTRAINT: pages pages_tenant_id_slug_key
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_tenant_id_slug_key UNIQUE (tenant_id, slug);

-- FK CONSTRAINT: pages pages_tenant_id_fkey
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_pages_published_version_id
CREATE INDEX idx_pages_published_version_id ON pages USING btree (published_version_id);

-- INDEX: idx_pages_tenant_created_at
-- 末尾の id は ListPages の cursor のタイブレーカー。
CREATE INDEX idx_pages_tenant_created_at ON pages USING btree (tenant_id, created_at, id);

-- ROW SECURITY: pages
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

-- POLICY: pages pages_tenant_isolation
CREATE POLICY pages_tenant_isolation ON pages USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: page_versions
CREATE TABLE page_versions (
    id uuid NOT NULL,
    page_id uuid NOT NULL,
    version_number integer NOT NULL,
    content_markdown text DEFAULT ''::text NOT NULL,
    author_user_id uuid,
    status character varying(20) DEFAULT 'draft'::character varying NOT NULL,
    publish_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    published_at timestamp with time zone,
    tenant_id uuid NOT NULL,
    CONSTRAINT page_versions_check CHECK (((((status)::text = 'draft'::text) AND (published_at IS NULL)) OR (((status)::text = 'published'::text) AND (published_at IS NOT NULL)))),
    CONSTRAINT page_versions_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying])::text[]))),
    CONSTRAINT page_versions_version_number_check CHECK ((version_number > 0))
);

-- CONSTRAINT: page_versions page_versions_page_id_version_number_key
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_page_id_version_number_key UNIQUE (page_id, version_number);

-- CONSTRAINT: page_versions page_versions_pkey
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: page_versions fk_page_versions_tenant_id
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT fk_page_versions_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: page_versions page_versions_author_user_id_fkey
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES users(id);

-- FK CONSTRAINT: page_versions page_versions_page_id_fkey
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_page_id_fkey FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE;

-- INDEX: idx_page_versions_page_id_created_at
CREATE INDEX idx_page_versions_page_id_created_at ON page_versions USING btree (page_id, created_at DESC);

-- INDEX: idx_page_versions_status_publish_at
CREATE INDEX idx_page_versions_status_publish_at ON page_versions USING btree (status, publish_at);

-- INDEX: idx_page_versions_tenant_id
CREATE INDEX idx_page_versions_tenant_id ON page_versions USING btree (tenant_id);

-- ROW SECURITY: page_versions
ALTER TABLE page_versions ENABLE ROW LEVEL SECURITY;

-- POLICY: page_versions page_versions_tenant_isolation
CREATE POLICY page_versions_tenant_isolation ON page_versions USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- Circular references inside this domain: these foreign keys are added
-- once every table above exists.

-- FK CONSTRAINT: pages pages_published_version_id_fkey
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_published_version_id_fkey FOREIGN KEY (published_version_id) REFERENCES page_versions(id) ON DELETE SET NULL;
