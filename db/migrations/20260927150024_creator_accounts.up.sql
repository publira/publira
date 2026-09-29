-- TABLE: creator_accounts
-- The reader accounts that belong to a credited creator. Many to many: one
-- person writes under several names, and a shared pen name is held by several
-- people.
CREATE TABLE creator_accounts (
    tenant_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: creator_accounts creator_accounts_pkey
ALTER TABLE ONLY creator_accounts
    ADD CONSTRAINT creator_accounts_pkey PRIMARY KEY (creator_id, user_id);

-- FK CONSTRAINT: creator_accounts creator_accounts_tenant_id_fkey
ALTER TABLE ONLY creator_accounts
    ADD CONSTRAINT creator_accounts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_accounts creator_accounts_tenant_creator_id_fkey
ALTER TABLE ONLY creator_accounts
    ADD CONSTRAINT creator_accounts_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_accounts creator_accounts_tenant_user_id_fkey
ALTER TABLE ONLY creator_accounts
    ADD CONSTRAINT creator_accounts_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_creator_accounts_tenant_user_id
-- Answers which creators an account belongs to, and serves the cascade when
-- the account is deleted.
CREATE INDEX idx_creator_accounts_tenant_user_id ON creator_accounts USING btree (tenant_id, user_id);

-- ROW SECURITY: creator_accounts
ALTER TABLE creator_accounts ENABLE ROW LEVEL SECURITY;

-- POLICY: creator_accounts creator_accounts_tenant_isolation
CREATE POLICY creator_accounts_tenant_isolation ON creator_accounts USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
