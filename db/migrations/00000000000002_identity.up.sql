-- Identity: Tenant member accounts, their credential and email tokens, notification
-- settings, and the per-tenant audit trail.

-- TABLE: users
CREATE TABLE users (
    id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    tenant_id uuid,
    email_verified_at timestamp with time zone,
    credentials_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'inactive'::character varying])::text[])))
);

-- CONSTRAINT: users users_pkey
ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);

-- CONSTRAINT: users users_public_id_key
ALTER TABLE ONLY users
    ADD CONSTRAINT users_public_id_key UNIQUE (public_id);

-- CONSTRAINT: users users_tenant_id_id_key
-- Enables composite FKs that keep child rows on the same tenant as the user.
-- tenant_id is nullable on users; rows with NULL tenant_id cannot be referenced by composite FKs.
ALTER TABLE ONLY users
    ADD CONSTRAINT users_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: users users_tenant_id_fkey
ALTER TABLE ONLY users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_users_created_at
-- テナントを跨ぐ ListEndUsers の cursor 用。tenant_id 先頭の索引は
-- 全テナントを走る一覧では使えないので、並び替えキーだけの索引を別に張る。
CREATE INDEX idx_users_created_at ON users USING btree (created_at DESC, id DESC);

-- INDEX: idx_users_tenant_created_at
CREATE INDEX idx_users_tenant_created_at ON users USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_users_tenant_id_email
CREATE UNIQUE INDEX idx_users_tenant_id_email ON users USING btree (tenant_id, email) WHERE (tenant_id IS NOT NULL);

-- ROW SECURITY: users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- POLICY: users users_tenant_isolation
CREATE POLICY users_tenant_isolation ON users USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_email_change_tokens
CREATE TABLE user_email_change_tokens (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    current_email character varying(255) NOT NULL,
    new_email character varying(255) NOT NULL,
    current_email_token_hash text NOT NULL,
    new_email_token_hash text NOT NULL,
    current_email_confirmed_at timestamp with time zone,
    new_email_confirmed_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_email_change_tokens user_email_change_tokens_current_email_token_hash_key
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_current_email_token_hash_key UNIQUE (current_email_token_hash);

-- CONSTRAINT: user_email_change_tokens user_email_change_tokens_new_email_token_hash_key
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_new_email_token_hash_key UNIQUE (new_email_token_hash);

-- CONSTRAINT: user_email_change_tokens user_email_change_tokens_pkey
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: user_email_change_tokens user_email_change_tokens_tenant_id_fkey
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_email_change_tokens user_email_change_tokens_user_id_fkey
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- INDEX: idx_user_email_change_tokens_tenant_current_token
CREATE INDEX idx_user_email_change_tokens_tenant_current_token ON user_email_change_tokens USING btree (tenant_id, current_email_token_hash);

-- INDEX: idx_user_email_change_tokens_tenant_new_token
CREATE INDEX idx_user_email_change_tokens_tenant_new_token ON user_email_change_tokens USING btree (tenant_id, new_email_token_hash);

-- INDEX: idx_user_email_change_tokens_user_id
CREATE INDEX idx_user_email_change_tokens_user_id ON user_email_change_tokens USING btree (user_id);

-- ROW SECURITY: user_email_change_tokens
ALTER TABLE user_email_change_tokens ENABLE ROW LEVEL SECURITY;

-- POLICY: user_email_change_tokens user_email_change_tokens_tenant_isolation
CREATE POLICY user_email_change_tokens_tenant_isolation ON user_email_change_tokens USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_email_verification_tokens
CREATE TABLE user_email_verification_tokens (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_pkey
ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_pkey PRIMARY KEY (id);

-- CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_token_hash_key
ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_token_hash_key UNIQUE (token_hash);

-- FK CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_tenant_id_fkey
ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_user_id_fkey
ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- INDEX: idx_user_email_verification_tokens_tenant_token
CREATE INDEX idx_user_email_verification_tokens_tenant_token ON user_email_verification_tokens USING btree (tenant_id, token_hash);

-- INDEX: idx_user_email_verification_tokens_user_id
CREATE INDEX idx_user_email_verification_tokens_user_id ON user_email_verification_tokens USING btree (user_id);

-- ROW SECURITY: user_email_verification_tokens
ALTER TABLE user_email_verification_tokens ENABLE ROW LEVEL SECURITY;

-- POLICY: user_email_verification_tokens user_email_verification_tokens_tenant_isolation
CREATE POLICY user_email_verification_tokens_tenant_isolation ON user_email_verification_tokens USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_password_reset_tokens
CREATE TABLE user_password_reset_tokens (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_pkey
ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_pkey PRIMARY KEY (id);

-- CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_token_hash_key
ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_token_hash_key UNIQUE (token_hash);

-- FK CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_tenant_id_fkey
ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_user_id_fkey
ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- INDEX: idx_user_password_reset_tokens_tenant_token
CREATE INDEX idx_user_password_reset_tokens_tenant_token ON user_password_reset_tokens USING btree (tenant_id, token_hash);

-- INDEX: idx_user_password_reset_tokens_user_id
CREATE INDEX idx_user_password_reset_tokens_user_id ON user_password_reset_tokens USING btree (user_id);

-- ROW SECURITY: user_password_reset_tokens
ALTER TABLE user_password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- POLICY: user_password_reset_tokens user_password_reset_tokens_tenant_isolation
CREATE POLICY user_password_reset_tokens_tenant_isolation ON user_password_reset_tokens USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: user_notification_settings
CREATE TABLE user_notification_settings (
    user_id uuid NOT NULL,
    email_notifications_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: user_notification_settings user_notification_settings_pkey
ALTER TABLE ONLY user_notification_settings
    ADD CONSTRAINT user_notification_settings_pkey PRIMARY KEY (user_id);

-- FK CONSTRAINT: user_notification_settings user_notification_settings_user_id_fkey
ALTER TABLE ONLY user_notification_settings
    ADD CONSTRAINT user_notification_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- TABLE: tenant_user_roles
CREATE TABLE tenant_user_roles (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL
);

-- CONSTRAINT: tenant_user_roles tenant_user_roles_pkey
ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT tenant_user_roles_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_user_roles tenant_user_roles_user_id_role_key
ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT tenant_user_roles_user_id_role_key UNIQUE (user_id, role);

-- FK CONSTRAINT: tenant_user_roles fk_tenant_user_roles_tenant_id
ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT fk_tenant_user_roles_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_user_roles tenant_user_roles_user_id_fkey
ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT tenant_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- INDEX: idx_tenant_user_roles_tenant_id
CREATE INDEX idx_tenant_user_roles_tenant_id ON tenant_user_roles USING btree (tenant_id);

-- ROW SECURITY: tenant_user_roles
ALTER TABLE tenant_user_roles ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_user_roles tenant_user_roles_tenant_isolation
CREATE POLICY tenant_user_roles_tenant_isolation ON tenant_user_roles USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: audit_logs
CREATE TABLE audit_logs (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    actor_user_id uuid NOT NULL,
    actor_role character varying(32) NOT NULL,
    action character varying(64) NOT NULL,
    target_type character varying(64),
    target_id text,
    outcome character varying(16) NOT NULL,
    reason text,
    client_ip character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: audit_logs audit_logs_pkey
ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: audit_logs audit_logs_actor_user_id_fkey
ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id);

-- FK CONSTRAINT: audit_logs audit_logs_tenant_id_fkey
ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_audit_logs_actor_user_id
CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs USING btree (actor_user_id);

-- INDEX: idx_audit_logs_tenant_created_at
CREATE INDEX idx_audit_logs_tenant_created_at ON audit_logs USING btree (tenant_id, created_at DESC, id DESC);

-- ROW SECURITY: audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- POLICY: audit_logs audit_logs_tenant_isolation
CREATE POLICY audit_logs_tenant_isolation ON audit_logs USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
