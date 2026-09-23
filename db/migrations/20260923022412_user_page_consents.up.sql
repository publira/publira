-- TABLE: user_page_consents
-- The page versions a reader agreed to, one row per version. The version rather
-- than a timestamp alone is what lets a tenant that revises its terms tell which
-- readers agreed to the old text.
CREATE TABLE user_page_consents (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    page_version_id uuid NOT NULL,
    agreed_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_page_consents user_page_consents_pkey
ALTER TABLE ONLY user_page_consents
    ADD CONSTRAINT user_page_consents_pkey PRIMARY KEY (user_id, page_version_id);

-- FK CONSTRAINT: user_page_consents user_page_consents_tenant_id_fkey
ALTER TABLE ONLY user_page_consents
    ADD CONSTRAINT user_page_consents_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_page_consents user_page_consents_tenant_user_id_fkey
ALTER TABLE ONLY user_page_consents
    ADD CONSTRAINT user_page_consents_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_page_consents user_page_consents_tenant_page_version_id_fkey
-- No cascade: deleting a version a reader agreed to would erase the record of
-- what they agreed to.
ALTER TABLE ONLY user_page_consents
    ADD CONSTRAINT user_page_consents_tenant_page_version_id_fkey FOREIGN KEY (tenant_id, page_version_id) REFERENCES page_versions(tenant_id, id);

-- INDEX: idx_user_page_consents_tenant_page_version_id
-- Answers which readers agreed to a given version.
CREATE INDEX idx_user_page_consents_tenant_page_version_id ON user_page_consents USING btree (tenant_id, page_version_id);

-- ROW SECURITY: user_page_consents
ALTER TABLE user_page_consents ENABLE ROW LEVEL SECURITY;

-- POLICY: user_page_consents user_page_consents_tenant_isolation
CREATE POLICY user_page_consents_tenant_isolation ON user_page_consents USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
