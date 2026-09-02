-- Platform: Tenants, their per-tenant configuration and branding, and the platform
-- operator accounts that administer them.

-- TABLE: tenants
CREATE TABLE tenants (
    id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    domain character varying(255) NOT NULL,
    name text NOT NULL,
    default_reading_period_hours integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    admin_domain character varying(255),
    -- IANA time zone name for tenant wall-clock display/input (e.g. Asia/Tokyo, America/Los_Angeles, UTC).
    -- Strict allow-list validation is enforced at the application/API layer.
    timezone text DEFAULT 'Asia/Tokyo'::text NOT NULL,
    -- Default UI locale when the user has not chosen one (e.g. ja, en).
    -- No column default: tenant creation must name the locale it means, so a
    -- tenant can never be created with an unstated language.
    -- Canonical codes live in locales/*.json (first cut: ja / en).
    -- Strict allow-list validation is enforced at the application/API layer.
    default_locale text NOT NULL,
    CONSTRAINT tenants_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying])::text[]))),
    CONSTRAINT tenants_timezone_not_blank_check CHECK ((btrim(timezone) <> '')),
    CONSTRAINT tenants_default_locale_not_blank_check CHECK ((btrim(default_locale) <> ''))
);

-- CONSTRAINT: tenants tenants_admin_domain_key
ALTER TABLE ONLY tenants
    ADD CONSTRAINT tenants_admin_domain_key UNIQUE (admin_domain);

-- CONSTRAINT: tenants tenants_domain_key
ALTER TABLE ONLY tenants
    ADD CONSTRAINT tenants_domain_key UNIQUE (domain);

-- CONSTRAINT: tenants tenants_pkey
ALTER TABLE ONLY tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenants tenants_public_id_key
ALTER TABLE ONLY tenants
    ADD CONSTRAINT tenants_public_id_key UNIQUE (public_id);

-- INDEX: idx_tenants_created_at
-- 末尾の id はテナント一覧の cursor のタイブレーカー。btree は逆順にも
-- 走査できるので、この 1 本で次ページと前ページの両方を索引順に取り出せる。
CREATE INDEX idx_tenants_created_at ON tenants USING btree (created_at DESC, id DESC);

-- TABLE: tenant_config
CREATE TABLE tenant_config (
    tenant_id uuid NOT NULL,
    copyright_text text,
    site_description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    site_tagline text
);

-- CONSTRAINT: tenant_config tenant_config_pkey
ALTER TABLE ONLY tenant_config
    ADD CONSTRAINT tenant_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_config tenant_config_tenant_id_fkey
ALTER TABLE ONLY tenant_config
    ADD CONSTRAINT tenant_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_config
ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_config tenant_config_tenant_isolation
CREATE POLICY tenant_config_tenant_isolation ON tenant_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_themes
CREATE TABLE tenant_themes (
    tenant_id uuid NOT NULL,
    primary_color character varying(32) DEFAULT '#0f7c82'::character varying NOT NULL,
    secondary_color character varying(32) DEFAULT '#b35235'::character varying NOT NULL,
    accent_color character varying(32) DEFAULT '#7aae90'::character varying NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    background_color character varying(32) DEFAULT '#f6f2e9'::character varying NOT NULL,
    foreground_color character varying(32) DEFAULT '#1e2b38'::character varying NOT NULL,
    surface_color character varying(32) DEFAULT '#fbf8f2'::character varying NOT NULL,
    surface_foreground_color character varying(32) DEFAULT '#1e2b38'::character varying NOT NULL,
    card_color character varying(32) DEFAULT '#fffdf8'::character varying NOT NULL,
    card_foreground_color character varying(32) DEFAULT '#1e2b38'::character varying NOT NULL,
    popover_color character varying(32) DEFAULT '#fffdf8'::character varying NOT NULL,
    popover_foreground_color character varying(32) DEFAULT '#1e2b38'::character varying NOT NULL,
    primary_foreground_color character varying(32) DEFAULT '#f4fbfb'::character varying NOT NULL,
    secondary_foreground_color character varying(32) DEFAULT '#fff6f1'::character varying NOT NULL,
    accent_foreground_color character varying(32) DEFAULT '#0f2a1f'::character varying NOT NULL,
    muted_color character varying(32) DEFAULT '#e9e1d3'::character varying NOT NULL,
    muted_foreground_color character varying(32) DEFAULT '#56616e'::character varying NOT NULL,
    border_color character varying(32) DEFAULT '#d7ccba'::character varying NOT NULL,
    input_color character varying(32) DEFAULT '#e3d8c7'::character varying NOT NULL,
    ring_color character varying(32) DEFAULT '#2d8d93'::character varying NOT NULL,
    success_color character varying(32) DEFAULT '#247542'::character varying NOT NULL,
    success_foreground_color character varying(32) DEFAULT '#f3fcf7'::character varying NOT NULL,
    warning_color character varying(32) DEFAULT '#9b6217'::character varying NOT NULL,
    warning_foreground_color character varying(32) DEFAULT '#fff8ea'::character varying NOT NULL,
    destructive_color character varying(32) DEFAULT '#b54444'::character varying NOT NULL,
    destructive_foreground_color character varying(32) DEFAULT '#fff4f4'::character varying NOT NULL,
    info_color character varying(32) DEFAULT '#2b5e9f'::character varying NOT NULL,
    info_foreground_color character varying(32) DEFAULT '#f3f8ff'::character varying NOT NULL,
    icon_image_id uuid,
    logo_image_id uuid
);

-- CONSTRAINT: tenant_themes tenant_themes_pkey
ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_themes tenant_themes_tenant_id_fkey
ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_themes
ALTER TABLE tenant_themes ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_themes tenant_themes_tenant_isolation
CREATE POLICY tenant_themes_tenant_isolation ON tenant_themes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_smtp_config
CREATE TABLE tenant_smtp_config (
    tenant_id uuid NOT NULL,
    smtp_override_enabled boolean DEFAULT false NOT NULL,
    host text,
    port integer,
    username text,
    password_encrypted text,
    encryption character varying(16),
    from_name text,
    from_address character varying(255),
    reply_to character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_smtp_config_encryption_check CHECK (((encryption)::text = ANY ((ARRAY['tls'::character varying, 'starttls'::character varying, 'none'::character varying])::text[]))),
    CONSTRAINT tenant_smtp_config_port_check CHECK (((port >= 1) AND (port <= 65535))),
    CONSTRAINT tenant_smtp_config_required_when_enabled CHECK (((NOT smtp_override_enabled) OR ((host IS NOT NULL) AND (port IS NOT NULL) AND (username IS NOT NULL) AND (password_encrypted IS NOT NULL) AND (encryption IS NOT NULL) AND (from_address IS NOT NULL))))
);

-- CONSTRAINT: tenant_smtp_config tenant_smtp_config_pkey
ALTER TABLE ONLY tenant_smtp_config
    ADD CONSTRAINT tenant_smtp_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_smtp_config tenant_smtp_config_tenant_id_fkey
ALTER TABLE ONLY tenant_smtp_config
    ADD CONSTRAINT tenant_smtp_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_smtp_config
ALTER TABLE tenant_smtp_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_smtp_config tenant_smtp_config_tenant_isolation
CREATE POLICY tenant_smtp_config_tenant_isolation ON tenant_smtp_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_payment_config
-- Per-tenant payment provider credentials. Secret key and webhook signing
-- secret are stored only as secretcrypto envelopes; hints are masked display
-- values so callers never need to decrypt to describe configuration state.
CREATE TABLE tenant_payment_config (
    tenant_id uuid NOT NULL,
    provider character varying(32) DEFAULT 'stripe'::character varying NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    secret_key_encrypted text,
    webhook_secret_encrypted text,
    secret_key_hint text,
    webhook_secret_hint text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_payment_config_provider_check CHECK (((provider)::text = 'stripe'::text)),
    CONSTRAINT tenant_payment_config_secret_key_encrypted_envelope_check CHECK (((secret_key_encrypted IS NULL) OR (secret_key_encrypted LIKE 'enc:%'::text))),
    CONSTRAINT tenant_payment_config_webhook_secret_encrypted_envelope_check CHECK (((webhook_secret_encrypted IS NULL) OR (webhook_secret_encrypted LIKE 'enc:%'::text))),
    CONSTRAINT tenant_payment_config_enabled_requires_secrets CHECK (((NOT enabled) OR ((secret_key_encrypted IS NOT NULL) AND (btrim(secret_key_encrypted) <> ''::text) AND (webhook_secret_encrypted IS NOT NULL) AND (btrim(webhook_secret_encrypted) <> ''::text))))
);

-- CONSTRAINT: tenant_payment_config tenant_payment_config_pkey
ALTER TABLE ONLY tenant_payment_config
    ADD CONSTRAINT tenant_payment_config_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_payment_config tenant_payment_config_tenant_id_fkey
ALTER TABLE ONLY tenant_payment_config
    ADD CONSTRAINT tenant_payment_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_payment_config
ALTER TABLE tenant_payment_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_payment_config tenant_payment_config_tenant_isolation
CREATE POLICY tenant_payment_config_tenant_isolation ON tenant_payment_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_images
CREATE TABLE tenant_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: tenant_images tenant_images_pkey
ALTER TABLE ONLY tenant_images
    ADD CONSTRAINT tenant_images_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: tenant_images tenant_images_tenant_id_fkey
ALTER TABLE ONLY tenant_images
    ADD CONSTRAINT tenant_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_tenant_images_tenant_id
CREATE INDEX idx_tenant_images_tenant_id ON tenant_images USING btree (tenant_id);

-- ROW SECURITY: tenant_images
ALTER TABLE tenant_images ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_images tenant_images_tenant_isolation
CREATE POLICY tenant_images_tenant_isolation ON tenant_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_image_variants
CREATE TABLE tenant_image_variants (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    tenant_image_id uuid NOT NULL,
    label character varying(32) NOT NULL,
    variant_type character varying(16) NOT NULL,
    storage_provider character varying(32) NOT NULL,
    object_key text NOT NULL,
    content_type character varying(255) NOT NULL,
    file_size_bytes bigint NOT NULL,
    width integer NOT NULL,
    height integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_image_variants_file_size_bytes_check CHECK ((file_size_bytes > 0)),
    CONSTRAINT tenant_image_variants_height_check CHECK ((height > 0)),
    CONSTRAINT tenant_image_variants_variant_type_check CHECK (((variant_type)::text = ANY ((ARRAY['logo'::character varying, 'icon'::character varying])::text[]))),
    CONSTRAINT tenant_image_variants_width_check CHECK ((width > 0))
);

-- CONSTRAINT: tenant_image_variants tenant_image_variants_pkey
ALTER TABLE ONLY tenant_image_variants
    ADD CONSTRAINT tenant_image_variants_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: tenant_image_variants tenant_image_variants_tenant_image_id_fkey
ALTER TABLE ONLY tenant_image_variants
    ADD CONSTRAINT tenant_image_variants_tenant_image_id_fkey FOREIGN KEY (tenant_image_id) REFERENCES tenant_images(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_image_variants tenant_image_variants_tenant_id_fkey
ALTER TABLE ONLY tenant_image_variants
    ADD CONSTRAINT tenant_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_tenant_image_variants_tenant_image_id
CREATE INDEX idx_tenant_image_variants_tenant_image_id ON tenant_image_variants USING btree (tenant_image_id);

-- INDEX: idx_tenant_image_variants_object_key
CREATE INDEX idx_tenant_image_variants_object_key ON tenant_image_variants USING btree (object_key);

-- INDEX: idx_tenant_image_variants_tenant_id
CREATE INDEX idx_tenant_image_variants_tenant_id ON tenant_image_variants USING btree (tenant_id);

-- INDEX: uq_tenant_image_variants_image_type
-- A branding image holds one variant per type, so the pair is unique. It is also
-- how the image server and the theme read look the rows up.
CREATE UNIQUE INDEX uq_tenant_image_variants_image_type ON tenant_image_variants USING btree (tenant_image_id, variant_type);

-- ROW SECURITY: tenant_image_variants
ALTER TABLE tenant_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_image_variants tenant_image_variants_tenant_isolation
CREATE POLICY tenant_image_variants_tenant_isolation ON tenant_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_admin_invitations
CREATE TABLE tenant_admin_invitations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    canceled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: tenant_admin_invitations tenant_admin_invitations_pkey
ALTER TABLE ONLY tenant_admin_invitations
    ADD CONSTRAINT tenant_admin_invitations_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_admin_invitations tenant_admin_invitations_tenant_id_email_key
ALTER TABLE ONLY tenant_admin_invitations
    ADD CONSTRAINT tenant_admin_invitations_tenant_id_email_key UNIQUE (tenant_id, email);

-- FK CONSTRAINT: tenant_admin_invitations tenant_admin_invitations_tenant_id_fkey
ALTER TABLE ONLY tenant_admin_invitations
    ADD CONSTRAINT tenant_admin_invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_tenant_admin_invitations_tenant_created_at
-- 末尾の id は招待一覧の cursor のタイブレーカー。btree は逆順にも走査
-- できるので、この 1 本で次ページと前ページの両方を索引順に取り出せる。
CREATE INDEX idx_tenant_admin_invitations_tenant_created_at ON tenant_admin_invitations USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_tenant_admin_invitations_tenant_token_hash
CREATE UNIQUE INDEX idx_tenant_admin_invitations_tenant_token_hash ON tenant_admin_invitations USING btree (tenant_id, token_hash);

-- ROW SECURITY: tenant_admin_invitations
ALTER TABLE tenant_admin_invitations ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_admin_invitations tenant_admin_invitations_tenant_isolation
CREATE POLICY tenant_admin_invitations_tenant_isolation ON tenant_admin_invitations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: platform_config
CREATE TABLE platform_config (
    singleton boolean DEFAULT true NOT NULL,
    -- Platform-wide default IANA time zone. New tenants start from this value and
    -- it is the fallback when a tenant row has no usable timezone.
    -- Strict allow-list validation is enforced at the application/API layer.
    default_timezone text DEFAULT 'Asia/Tokyo'::text NOT NULL,
    -- Platform-wide default UI locale: the console's display language when the
    -- operator has chosen none. It stands in for no other row — tenant
    -- creation states its own locale, and a tenant read resolves the tenant's.
    -- No column default: every writer names the locale it means, so a row can
    -- never be created with an unstated language.
    -- Canonical codes live in locales/*.json (first cut: ja / en).
    -- Strict allow-list validation is enforced at the application/API layer.
    default_locale text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_config_default_timezone_not_blank_check CHECK ((btrim(default_timezone) <> '')),
    CONSTRAINT platform_config_default_locale_not_blank_check CHECK ((btrim(default_locale) <> '')),
    CONSTRAINT platform_config_singleton_check CHECK (singleton)
);

-- CONSTRAINT: platform_config platform_config_pkey
ALTER TABLE ONLY platform_config
    ADD CONSTRAINT platform_config_pkey PRIMARY KEY (singleton);

-- TABLE: platform_smtp_config
CREATE TABLE platform_smtp_config (
    singleton boolean DEFAULT true NOT NULL,
    host text NOT NULL,
    port integer NOT NULL,
    username text NOT NULL,
    password_encrypted text NOT NULL,
    encryption character varying(16) NOT NULL,
    from_address character varying(255) NOT NULL,
    reply_to character varying(255),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_smtp_config_encryption_check CHECK (((encryption)::text = ANY ((ARRAY['tls'::character varying, 'starttls'::character varying, 'none'::character varying])::text[]))),
    CONSTRAINT platform_smtp_config_port_check CHECK (((port >= 1) AND (port <= 65535))),
    CONSTRAINT platform_smtp_config_singleton_check CHECK (singleton)
);

-- CONSTRAINT: platform_smtp_config platform_smtp_config_pkey
ALTER TABLE ONLY platform_smtp_config
    ADD CONSTRAINT platform_smtp_config_pkey PRIMARY KEY (singleton);

-- TABLE: platform_users
CREATE TABLE platform_users (
    id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    name text NOT NULL,
    status character varying(20) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    credentials_version integer DEFAULT 1 NOT NULL
);

-- CONSTRAINT: platform_users platform_users_email_key
ALTER TABLE ONLY platform_users
    ADD CONSTRAINT platform_users_email_key UNIQUE (email);

-- CONSTRAINT: platform_users platform_users_pkey
ALTER TABLE ONLY platform_users
    ADD CONSTRAINT platform_users_pkey PRIMARY KEY (id);

-- CONSTRAINT: platform_users platform_users_public_id_key
ALTER TABLE ONLY platform_users
    ADD CONSTRAINT platform_users_public_id_key UNIQUE (public_id);

-- INDEX: idx_platform_users_created_at
-- 末尾の id はオペレーター一覧の cursor のタイブレーカー。btree は逆順にも
-- 走査できるので、この 1 本で次ページと前ページの両方を索引順に取り出せる。
CREATE INDEX idx_platform_users_created_at ON platform_users USING btree (created_at DESC, id DESC);

-- TABLE: platform_user_roles
CREATE TABLE platform_user_roles (
    id uuid NOT NULL,
    role character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    platform_user_id uuid NOT NULL
);

-- CONSTRAINT: platform_user_roles platform_user_roles_pkey
ALTER TABLE ONLY platform_user_roles
    ADD CONSTRAINT platform_user_roles_pkey PRIMARY KEY (id);

-- CONSTRAINT: platform_user_roles platform_user_roles_platform_user_id_role_key
ALTER TABLE ONLY platform_user_roles
    ADD CONSTRAINT platform_user_roles_platform_user_id_role_key UNIQUE (platform_user_id, role);

-- FK CONSTRAINT: platform_user_roles platform_user_roles_platform_user_id_fkey
ALTER TABLE ONLY platform_user_roles
    ADD CONSTRAINT platform_user_roles_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- TABLE: platform_user_email_change_tokens
CREATE TABLE platform_user_email_change_tokens (
    id uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    current_email character varying(255) NOT NULL,
    new_email character varying(255) NOT NULL,
    current_email_token_hash text CONSTRAINT platform_user_email_change_to_current_email_token_hash_not_null NOT NULL,
    new_email_token_hash text NOT NULL,
    current_email_confirmed_at timestamp with time zone,
    new_email_confirmed_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: platform_user_email_change_tokens platform_user_email_change_tokens_current_email_token_hash_key
ALTER TABLE ONLY platform_user_email_change_tokens
    ADD CONSTRAINT platform_user_email_change_tokens_current_email_token_hash_key UNIQUE (current_email_token_hash);

-- CONSTRAINT: platform_user_email_change_tokens platform_user_email_change_tokens_new_email_token_hash_key
ALTER TABLE ONLY platform_user_email_change_tokens
    ADD CONSTRAINT platform_user_email_change_tokens_new_email_token_hash_key UNIQUE (new_email_token_hash);

-- CONSTRAINT: platform_user_email_change_tokens platform_user_email_change_tokens_pkey
ALTER TABLE ONLY platform_user_email_change_tokens
    ADD CONSTRAINT platform_user_email_change_tokens_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: platform_user_email_change_tokens platform_user_email_change_tokens_platform_user_id_fkey
ALTER TABLE ONLY platform_user_email_change_tokens
    ADD CONSTRAINT platform_user_email_change_tokens_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- INDEX: idx_platform_user_email_change_tokens_current_token
CREATE INDEX idx_platform_user_email_change_tokens_current_token ON platform_user_email_change_tokens USING btree (current_email_token_hash);

-- INDEX: idx_platform_user_email_change_tokens_new_token
CREATE INDEX idx_platform_user_email_change_tokens_new_token ON platform_user_email_change_tokens USING btree (new_email_token_hash);

-- INDEX: idx_platform_user_email_change_tokens_user_id
CREATE INDEX idx_platform_user_email_change_tokens_user_id ON platform_user_email_change_tokens USING btree (platform_user_id);

-- TABLE: platform_user_password_reset_tokens
CREATE TABLE platform_user_password_reset_tokens (
    id uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: platform_user_password_reset_tokens platform_user_password_reset_tokens_pkey
ALTER TABLE ONLY platform_user_password_reset_tokens
    ADD CONSTRAINT platform_user_password_reset_tokens_pkey PRIMARY KEY (id);

-- CONSTRAINT: platform_user_password_reset_tokens platform_user_password_reset_tokens_token_hash_key
ALTER TABLE ONLY platform_user_password_reset_tokens
    ADD CONSTRAINT platform_user_password_reset_tokens_token_hash_key UNIQUE (token_hash);

-- FK CONSTRAINT: platform_user_password_reset_tokens platform_user_password_reset_tokens_platform_user_id_fkey
ALTER TABLE ONLY platform_user_password_reset_tokens
    ADD CONSTRAINT platform_user_password_reset_tokens_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- INDEX: idx_platform_user_password_reset_tokens_token_hash
CREATE INDEX idx_platform_user_password_reset_tokens_token_hash ON platform_user_password_reset_tokens USING btree (token_hash);

-- INDEX: idx_platform_user_password_reset_tokens_user_id
CREATE INDEX idx_platform_user_password_reset_tokens_user_id ON platform_user_password_reset_tokens USING btree (platform_user_id);

-- TABLE: platform_audit_logs
CREATE TABLE platform_audit_logs (
    id uuid NOT NULL,
    actor_role character varying(32) NOT NULL,
    action character varying(64) NOT NULL,
    target_type character varying(64),
    target_id character varying(64),
    outcome character varying(16) NOT NULL,
    reason text,
    client_ip character varying(64),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    actor_platform_user_id uuid NOT NULL
);

-- CONSTRAINT: platform_audit_logs admin_audit_logs_pkey
ALTER TABLE ONLY platform_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: platform_audit_logs platform_audit_logs_actor_platform_user_id_fkey
ALTER TABLE ONLY platform_audit_logs
    ADD CONSTRAINT platform_audit_logs_actor_platform_user_id_fkey FOREIGN KEY (actor_platform_user_id) REFERENCES platform_users(id);

-- INDEX: idx_platform_audit_logs_actor
CREATE INDEX idx_platform_audit_logs_actor ON platform_audit_logs USING btree (actor_platform_user_id);

-- INDEX: idx_platform_audit_logs_created_at
-- 末尾の id は Platform ListAuditLogs の cursor のタイブレーカー。btree は
-- 逆順にも走査できるので、この 1 本で次ページと前ページの両方を索引順に
-- 取り出せる。
CREATE INDEX idx_platform_audit_logs_created_at ON platform_audit_logs USING btree (created_at DESC, id DESC);

-- INDEX: idx_platform_audit_logs_target
CREATE INDEX idx_platform_audit_logs_target ON platform_audit_logs USING btree (target_type, target_id);

-- TABLE: platform_notifications
-- Personal in-app events for platform operators. No tenant_id and no tenant RLS.
CREATE TABLE platform_notifications (
    id uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    notification_type character varying(64) NOT NULL,
    subject_key character varying(255) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_notifications_payload_object_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT platform_notifications_subject_key_check CHECK ((char_length((subject_key)::text) > 0))
);

-- CONSTRAINT: platform_notifications platform_notifications_pkey
ALTER TABLE ONLY platform_notifications
    ADD CONSTRAINT platform_notifications_pkey PRIMARY KEY (id);

-- CONSTRAINT: platform_notifications platform_notifications_user_type_subject_key
ALTER TABLE ONLY platform_notifications
    ADD CONSTRAINT platform_notifications_user_type_subject_key UNIQUE (platform_user_id, notification_type, subject_key);

-- FK CONSTRAINT: platform_notifications platform_notifications_platform_user_id_fkey
ALTER TABLE ONLY platform_notifications
    ADD CONSTRAINT platform_notifications_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- INDEX: idx_platform_notifications_user_created_at
CREATE INDEX idx_platform_notifications_user_created_at ON platform_notifications USING btree (platform_user_id, created_at DESC, id DESC);

-- TABLE: platform_notification_reads
CREATE TABLE platform_notification_reads (
    platform_notification_id uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: platform_notification_reads platform_notification_reads_pkey
ALTER TABLE ONLY platform_notification_reads
    ADD CONSTRAINT platform_notification_reads_pkey PRIMARY KEY (platform_notification_id, platform_user_id);

-- FK CONSTRAINT: platform_notification_reads platform_notification_reads_notification_id_fkey
ALTER TABLE ONLY platform_notification_reads
    ADD CONSTRAINT platform_notification_reads_notification_id_fkey FOREIGN KEY (platform_notification_id) REFERENCES platform_notifications(id) ON DELETE CASCADE;

-- FK CONSTRAINT: platform_notification_reads platform_notification_reads_platform_user_id_fkey
ALTER TABLE ONLY platform_notification_reads
    ADD CONSTRAINT platform_notification_reads_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- INDEX: idx_platform_notification_reads_user_notification
CREATE INDEX idx_platform_notification_reads_user_notification ON platform_notification_reads USING btree (platform_user_id, platform_notification_id);

-- Circular references inside this domain: these foreign keys are added
-- once every table above exists.

-- FK CONSTRAINT: tenant_themes tenant_themes_icon_image_id_fkey
ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_icon_image_id_fkey FOREIGN KEY (icon_image_id) REFERENCES tenant_images(id) ON DELETE SET NULL;

-- FK CONSTRAINT: tenant_themes tenant_themes_logo_image_id_fkey
ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_logo_image_id_fkey FOREIGN KEY (logo_image_id) REFERENCES tenant_images(id) ON DELETE SET NULL;
