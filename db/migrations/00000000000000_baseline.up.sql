-- TABLE: access_tickets
-- Admin-issued viewing grants (ticket-style access, separate from purchases).
CREATE TABLE access_tickets (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    episode_id uuid NOT NULL,
    user_id uuid NOT NULL,
    expires_at timestamp with time zone,
    revoked_at timestamp with time zone,
    note text,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

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

-- TABLE: creator_images
CREATE TABLE creator_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

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

-- TABLE: episode_images
CREATE TABLE episode_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

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

-- TABLE: label_images
CREATE TABLE label_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    label_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: labels
CREATE TABLE labels (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    public_id character varying(12) NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    eye_catch_image_id uuid
);

-- TABLE: announcement_reads
CREATE TABLE announcement_reads (
    announcement_id uuid NOT NULL,
    user_id uuid NOT NULL,
    read_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: announcements
CREATE TABLE announcements (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    target_user_id uuid,
    announcement_type character varying(64) NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    link_url text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

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

-- TABLE: platform_config
CREATE TABLE platform_config (
    singleton boolean DEFAULT true NOT NULL,
    -- Platform-wide default IANA time zone. New tenants start from this value and
    -- it is the fallback when a tenant row has no usable timezone.
    -- Strict allow-list validation is enforced at the application/API layer.
    default_timezone text DEFAULT 'Asia/Tokyo'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_config_default_timezone_not_blank_check CHECK ((btrim(default_timezone) <> '')),
    CONSTRAINT platform_config_singleton_check CHECK (singleton)
);

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

-- TABLE: platform_user_password_reset_tokens
CREATE TABLE platform_user_password_reset_tokens (
    id uuid NOT NULL,
    platform_user_id uuid NOT NULL,
    token_hash text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: platform_user_roles
CREATE TABLE platform_user_roles (
    id uuid NOT NULL,
    role character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    platform_user_id uuid NOT NULL
);

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

-- TABLE: purchases
CREATE TABLE purchases (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    episode_id uuid NOT NULL,
    price_at_purchase integer NOT NULL,
    expires_at timestamp with time zone,
    purchased_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL
);

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

-- TABLE: series_creators
CREATE TABLE series_creators (
    series_id uuid NOT NULL,
    creator_id uuid NOT NULL,
    role character varying(50) NOT NULL,
    display_order integer DEFAULT 0 NOT NULL,
    tenant_id uuid NOT NULL
);

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

-- TABLE: series_images
CREATE TABLE series_images (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);

-- TABLE: series_listings
CREATE TABLE series_listings (
    series_id uuid NOT NULL,
    synopsis text,
    reading_period_hours integer,
    is_published boolean DEFAULT false,
    published_at timestamp with time zone DEFAULT now(),
    tenant_id uuid NOT NULL
);

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

-- TABLE: tenant_config
CREATE TABLE tenant_config (
    tenant_id uuid NOT NULL,
    copyright_text text,
    site_description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    site_tagline text
);

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

-- TABLE: tenant_themes
CREATE TABLE tenant_themes (
    tenant_id uuid NOT NULL,
    primary_color character varying(32) DEFAULT '#0f7c82'::character varying NOT NULL,
    secondary_color character varying(32) DEFAULT '#d96f4a'::character varying NOT NULL,
    accent_color character varying(32) DEFAULT '#7aae90'::character varying NOT NULL,
    logo_url text,
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
    muted_foreground_color character varying(32) DEFAULT '#5c6773'::character varying NOT NULL,
    border_color character varying(32) DEFAULT '#d7ccba'::character varying NOT NULL,
    input_color character varying(32) DEFAULT '#e3d8c7'::character varying NOT NULL,
    ring_color character varying(32) DEFAULT '#2d8d93'::character varying NOT NULL,
    success_color character varying(32) DEFAULT '#2f8f5b'::character varying NOT NULL,
    success_foreground_color character varying(32) DEFAULT '#f3fcf7'::character varying NOT NULL,
    warning_color character varying(32) DEFAULT '#c4872a'::character varying NOT NULL,
    warning_foreground_color character varying(32) DEFAULT '#fff8ea'::character varying NOT NULL,
    destructive_color character varying(32) DEFAULT '#b54444'::character varying NOT NULL,
    destructive_foreground_color character varying(32) DEFAULT '#fff4f4'::character varying NOT NULL,
    info_color character varying(32) DEFAULT '#3c78c2'::character varying NOT NULL,
    info_foreground_color character varying(32) DEFAULT '#f3f8ff'::character varying NOT NULL
);

-- TABLE: tenant_user_roles
CREATE TABLE tenant_user_roles (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    role character varying(32) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    tenant_id uuid NOT NULL
);

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
    CONSTRAINT tenants_status_check CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying])::text[]))),
    CONSTRAINT tenants_timezone_not_blank_check CHECK ((btrim(timezone) <> ''))
);

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

-- TABLE: user_notification_settings
CREATE TABLE user_notification_settings (
    user_id uuid NOT NULL,
    email_notifications_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

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

-- CONSTRAINT: access_tickets access_tickets_pkey
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_pkey PRIMARY KEY (id);

-- CONSTRAINT: access_tickets access_tickets_tenant_public_id_key
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_public_id_key UNIQUE (tenant_id, public_id);

-- CONSTRAINT: platform_audit_logs admin_audit_logs_pkey
ALTER TABLE ONLY platform_audit_logs
    ADD CONSTRAINT admin_audit_logs_pkey PRIMARY KEY (id);

-- CONSTRAINT: audit_logs audit_logs_pkey
ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);

-- CONSTRAINT: creator_image_variants creator_image_variants_pkey
ALTER TABLE ONLY creator_image_variants
    ADD CONSTRAINT creator_image_variants_pkey PRIMARY KEY (id);

-- CONSTRAINT: creator_images creator_images_pkey
ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: creators creators_pkey
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_pkey PRIMARY KEY (id);

-- CONSTRAINT: creators creators_public_id_key
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_public_id_key UNIQUE (public_id);

-- CONSTRAINT: episode_image_variants episode_image_variants_pkey
ALTER TABLE ONLY episode_image_variants
    ADD CONSTRAINT episode_image_variants_pkey PRIMARY KEY (id);

-- CONSTRAINT: episode_images episode_images_pkey
ALTER TABLE ONLY episode_images
    ADD CONSTRAINT episode_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: episode_listings episode_listings_pkey
ALTER TABLE ONLY episode_listings
    ADD CONSTRAINT episode_listings_pkey PRIMARY KEY (episode_id);

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

-- CONSTRAINT: label_image_variants label_image_variants_pkey
ALTER TABLE ONLY label_image_variants
    ADD CONSTRAINT label_image_variants_pkey PRIMARY KEY (id);

-- CONSTRAINT: label_images label_images_pkey
ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: labels labels_pkey
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);

-- CONSTRAINT: labels labels_public_id_key
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_public_id_key UNIQUE (public_id);

-- CONSTRAINT: announcement_reads announcement_reads_pkey
ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_pkey PRIMARY KEY (announcement_id, user_id);

-- CONSTRAINT: announcements announcements_pkey
ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_pkey PRIMARY KEY (id);

-- CONSTRAINT: page_versions page_versions_page_id_version_number_key
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_page_id_version_number_key UNIQUE (page_id, version_number);

-- CONSTRAINT: page_versions page_versions_pkey
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_pkey PRIMARY KEY (id);

-- CONSTRAINT: pages pages_pkey
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);

-- CONSTRAINT: pages pages_tenant_id_slug_key
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_tenant_id_slug_key UNIQUE (tenant_id, slug);

-- CONSTRAINT: platform_config platform_config_pkey
ALTER TABLE ONLY platform_config
    ADD CONSTRAINT platform_config_pkey PRIMARY KEY (singleton);

-- CONSTRAINT: platform_smtp_config platform_smtp_config_pkey
ALTER TABLE ONLY platform_smtp_config
    ADD CONSTRAINT platform_smtp_config_pkey PRIMARY KEY (singleton);

-- CONSTRAINT: platform_user_email_change_tokens platform_user_email_change_tokens_current_email_token_hash_key
ALTER TABLE ONLY platform_user_email_change_tokens
    ADD CONSTRAINT platform_user_email_change_tokens_current_email_token_hash_key UNIQUE (current_email_token_hash);

-- CONSTRAINT: platform_user_email_change_tokens platform_user_email_change_tokens_new_email_token_hash_key
ALTER TABLE ONLY platform_user_email_change_tokens
    ADD CONSTRAINT platform_user_email_change_tokens_new_email_token_hash_key UNIQUE (new_email_token_hash);

-- CONSTRAINT: platform_user_email_change_tokens platform_user_email_change_tokens_pkey
ALTER TABLE ONLY platform_user_email_change_tokens
    ADD CONSTRAINT platform_user_email_change_tokens_pkey PRIMARY KEY (id);

-- CONSTRAINT: platform_user_password_reset_tokens platform_user_password_reset_tokens_pkey
ALTER TABLE ONLY platform_user_password_reset_tokens
    ADD CONSTRAINT platform_user_password_reset_tokens_pkey PRIMARY KEY (id);

-- CONSTRAINT: platform_user_password_reset_tokens platform_user_password_reset_tokens_token_hash_key
ALTER TABLE ONLY platform_user_password_reset_tokens
    ADD CONSTRAINT platform_user_password_reset_tokens_token_hash_key UNIQUE (token_hash);

-- CONSTRAINT: platform_user_roles platform_user_roles_pkey
ALTER TABLE ONLY platform_user_roles
    ADD CONSTRAINT platform_user_roles_pkey PRIMARY KEY (id);

-- CONSTRAINT: platform_user_roles platform_user_roles_platform_user_id_role_key
ALTER TABLE ONLY platform_user_roles
    ADD CONSTRAINT platform_user_roles_platform_user_id_role_key UNIQUE (platform_user_id, role);

-- CONSTRAINT: platform_users platform_users_email_key
ALTER TABLE ONLY platform_users
    ADD CONSTRAINT platform_users_email_key UNIQUE (email);

-- CONSTRAINT: platform_users platform_users_pkey
ALTER TABLE ONLY platform_users
    ADD CONSTRAINT platform_users_pkey PRIMARY KEY (id);

-- CONSTRAINT: platform_users platform_users_public_id_key
ALTER TABLE ONLY platform_users
    ADD CONSTRAINT platform_users_public_id_key UNIQUE (public_id);

-- CONSTRAINT: purchases purchases_pkey
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);

-- CONSTRAINT: series_creators series_creators_pkey
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_pkey PRIMARY KEY (series_id, creator_id);

-- CONSTRAINT: series_image_variants series_image_variants_pkey
ALTER TABLE ONLY series_image_variants
    ADD CONSTRAINT series_image_variants_pkey PRIMARY KEY (id);

-- CONSTRAINT: series_images series_images_pkey
ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_pkey PRIMARY KEY (id);

-- CONSTRAINT: series_listings series_listings_pkey
ALTER TABLE ONLY series_listings
    ADD CONSTRAINT series_listings_pkey PRIMARY KEY (series_id);

-- CONSTRAINT: series series_pkey
ALTER TABLE ONLY series
    ADD CONSTRAINT series_pkey PRIMARY KEY (id);

-- CONSTRAINT: series series_public_id_key
ALTER TABLE ONLY series
    ADD CONSTRAINT series_public_id_key UNIQUE (public_id);

-- CONSTRAINT: tenant_admin_invitations tenant_admin_invitations_pkey
ALTER TABLE ONLY tenant_admin_invitations
    ADD CONSTRAINT tenant_admin_invitations_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_admin_invitations tenant_admin_invitations_tenant_id_email_key
ALTER TABLE ONLY tenant_admin_invitations
    ADD CONSTRAINT tenant_admin_invitations_tenant_id_email_key UNIQUE (tenant_id, email);

-- CONSTRAINT: tenant_config tenant_config_pkey
ALTER TABLE ONLY tenant_config
    ADD CONSTRAINT tenant_config_pkey PRIMARY KEY (tenant_id);

-- CONSTRAINT: tenant_smtp_config tenant_smtp_config_pkey
ALTER TABLE ONLY tenant_smtp_config
    ADD CONSTRAINT tenant_smtp_config_pkey PRIMARY KEY (tenant_id);

-- CONSTRAINT: tenant_themes tenant_themes_pkey
ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_pkey PRIMARY KEY (tenant_id);

-- CONSTRAINT: tenant_user_roles tenant_user_roles_pkey
ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT tenant_user_roles_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_user_roles tenant_user_roles_user_id_role_key
ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT tenant_user_roles_user_id_role_key UNIQUE (user_id, role);

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

-- CONSTRAINT: user_email_change_tokens user_email_change_tokens_current_email_token_hash_key
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_current_email_token_hash_key UNIQUE (current_email_token_hash);

-- CONSTRAINT: user_email_change_tokens user_email_change_tokens_new_email_token_hash_key
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_new_email_token_hash_key UNIQUE (new_email_token_hash);

-- CONSTRAINT: user_email_change_tokens user_email_change_tokens_pkey
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_pkey PRIMARY KEY (id);

-- CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_pkey
ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_pkey PRIMARY KEY (id);

-- CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_token_hash_key
ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_token_hash_key UNIQUE (token_hash);

-- CONSTRAINT: user_notification_settings user_notification_settings_pkey
ALTER TABLE ONLY user_notification_settings
    ADD CONSTRAINT user_notification_settings_pkey PRIMARY KEY (user_id);

-- CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_pkey
ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_pkey PRIMARY KEY (id);

-- CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_token_hash_key
ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_token_hash_key UNIQUE (token_hash);

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

-- INDEX: idx_access_tickets_active_user_episode
-- At most one non-revoked ticket per (tenant, user, episode). Concurrent issue is serialized by this unique partial index.
CREATE UNIQUE INDEX idx_access_tickets_active_user_episode ON access_tickets USING btree (tenant_id, user_id, episode_id) WHERE (revoked_at IS NULL);

-- INDEX: idx_access_tickets_tenant_created_at
CREATE INDEX idx_access_tickets_tenant_created_at ON access_tickets USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_audit_logs_actor_user_id
CREATE INDEX idx_audit_logs_actor_user_id ON audit_logs USING btree (actor_user_id);

-- INDEX: idx_audit_logs_tenant_created_at
CREATE INDEX idx_audit_logs_tenant_created_at ON audit_logs USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_creator_image_variants_creator_image_id
CREATE INDEX idx_creator_image_variants_creator_image_id ON creator_image_variants USING btree (creator_image_id);

-- INDEX: idx_creator_image_variants_tenant_id
CREATE INDEX idx_creator_image_variants_tenant_id ON creator_image_variants USING btree (tenant_id);

-- INDEX: idx_creator_images_creator_id
CREATE INDEX idx_creator_images_creator_id ON creator_images USING btree (creator_id);

-- INDEX: idx_creator_images_tenant_id
CREATE INDEX idx_creator_images_tenant_id ON creator_images USING btree (tenant_id);

-- INDEX: idx_creators_tenant_created_at
CREATE INDEX idx_creators_tenant_created_at ON creators USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_episode_image_variants_episode_image_id
CREATE INDEX idx_episode_image_variants_episode_image_id ON episode_image_variants USING btree (episode_image_id);

-- INDEX: idx_episode_images_episode_id
CREATE INDEX idx_episode_images_episode_id ON episode_images USING btree (episode_id, display_order);

-- INDEX: idx_episode_images_tenant_id
CREATE INDEX idx_episode_images_tenant_id ON episode_images USING btree (tenant_id);

-- INDEX: idx_episode_listings_status_scheduled
CREATE INDEX idx_episode_listings_status_scheduled ON episode_listings USING btree (status, scheduled_at);

-- INDEX: idx_episode_listings_tenant_id
CREATE INDEX idx_episode_listings_tenant_id ON episode_listings USING btree (tenant_id);

-- INDEX: idx_episodes_series_order_index
CREATE INDEX idx_episodes_series_order_index ON episodes USING btree (series_id, order_index, id);

-- INDEX: idx_episodes_tenant_id
CREATE INDEX idx_episodes_tenant_id ON episodes USING btree (tenant_id);

-- INDEX: idx_label_image_variants_label_image_id
CREATE INDEX idx_label_image_variants_label_image_id ON label_image_variants USING btree (label_image_id);

-- INDEX: idx_label_image_variants_tenant_id
CREATE INDEX idx_label_image_variants_tenant_id ON label_image_variants USING btree (tenant_id);

-- INDEX: idx_label_images_label_id
CREATE INDEX idx_label_images_label_id ON label_images USING btree (label_id);

-- INDEX: idx_label_images_tenant_id
CREATE INDEX idx_label_images_tenant_id ON label_images USING btree (tenant_id);

-- INDEX: idx_labels_tenant_created_at
CREATE INDEX idx_labels_tenant_created_at ON labels USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_announcement_reads_user_announcement
CREATE INDEX idx_announcement_reads_user_announcement ON announcement_reads USING btree (user_id, announcement_id);

-- INDEX: idx_announcements_tenant_created_at
CREATE INDEX idx_announcements_tenant_created_at ON announcements USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_announcements_tenant_target_created_at
CREATE INDEX idx_announcements_tenant_target_created_at ON announcements USING btree (tenant_id, target_user_id, created_at DESC, id DESC);

-- INDEX: idx_page_versions_page_id_created_at
CREATE INDEX idx_page_versions_page_id_created_at ON page_versions USING btree (page_id, created_at DESC);

-- INDEX: idx_page_versions_status_publish_at
CREATE INDEX idx_page_versions_status_publish_at ON page_versions USING btree (status, publish_at);

-- INDEX: idx_page_versions_tenant_id
CREATE INDEX idx_page_versions_tenant_id ON page_versions USING btree (tenant_id);

-- INDEX: idx_pages_published_version_id
CREATE INDEX idx_pages_published_version_id ON pages USING btree (published_version_id);

-- INDEX: idx_pages_tenant_created_at
-- 末尾の id は ListPages の cursor のタイブレーカー。
CREATE INDEX idx_pages_tenant_created_at ON pages USING btree (tenant_id, created_at, id);

-- INDEX: idx_platform_audit_logs_actor
CREATE INDEX idx_platform_audit_logs_actor ON platform_audit_logs USING btree (actor_platform_user_id);

-- INDEX: idx_platform_audit_logs_created_at
CREATE INDEX idx_platform_audit_logs_created_at ON platform_audit_logs USING btree (created_at DESC);

-- INDEX: idx_platform_audit_logs_target
CREATE INDEX idx_platform_audit_logs_target ON platform_audit_logs USING btree (target_type, target_id);

-- INDEX: idx_platform_users_created_at
-- 末尾の id はオペレーター一覧の cursor のタイブレーカー。btree は逆順にも
-- 走査できるので、この 1 本で次ページと前ページの両方を索引順に取り出せる。
CREATE INDEX idx_platform_users_created_at ON platform_users USING btree (created_at DESC, id DESC);

-- INDEX: idx_platform_user_email_change_tokens_current_token
CREATE INDEX idx_platform_user_email_change_tokens_current_token ON platform_user_email_change_tokens USING btree (current_email_token_hash);

-- INDEX: idx_platform_user_email_change_tokens_new_token
CREATE INDEX idx_platform_user_email_change_tokens_new_token ON platform_user_email_change_tokens USING btree (new_email_token_hash);

-- INDEX: idx_platform_user_email_change_tokens_user_id
CREATE INDEX idx_platform_user_email_change_tokens_user_id ON platform_user_email_change_tokens USING btree (platform_user_id);

-- INDEX: idx_platform_user_password_reset_tokens_token_hash
CREATE INDEX idx_platform_user_password_reset_tokens_token_hash ON platform_user_password_reset_tokens USING btree (token_hash);

-- INDEX: idx_platform_user_password_reset_tokens_user_id
CREATE INDEX idx_platform_user_password_reset_tokens_user_id ON platform_user_password_reset_tokens USING btree (platform_user_id);

-- INDEX: idx_purchases_tenant_id
CREATE INDEX idx_purchases_tenant_id ON purchases USING btree (tenant_id);

-- INDEX: idx_series_creators_tenant_id
CREATE INDEX idx_series_creators_tenant_id ON series_creators USING btree (tenant_id);

-- INDEX: idx_series_image_variants_series_image_id
CREATE INDEX idx_series_image_variants_series_image_id ON series_image_variants USING btree (series_image_id);

-- INDEX: idx_series_image_variants_tenant_id
CREATE INDEX idx_series_image_variants_tenant_id ON series_image_variants USING btree (tenant_id);

-- INDEX: idx_series_images_series_id
CREATE INDEX idx_series_images_series_id ON series_images USING btree (series_id);

-- INDEX: idx_series_images_tenant_id
CREATE INDEX idx_series_images_tenant_id ON series_images USING btree (tenant_id);

-- INDEX: idx_series_listings_tenant_id
CREATE INDEX idx_series_listings_tenant_id ON series_listings USING btree (tenant_id);

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

-- INDEX: idx_tenant_admin_invitations_tenant_created_at
-- 末尾の id は招待一覧の cursor のタイブレーカー。btree は逆順にも走査
-- できるので、この 1 本で次ページと前ページの両方を索引順に取り出せる。
CREATE INDEX idx_tenant_admin_invitations_tenant_created_at ON tenant_admin_invitations USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_tenant_admin_invitations_tenant_token_hash
CREATE UNIQUE INDEX idx_tenant_admin_invitations_tenant_token_hash ON tenant_admin_invitations USING btree (tenant_id, token_hash);

-- INDEX: idx_tenant_user_roles_tenant_id
CREATE INDEX idx_tenant_user_roles_tenant_id ON tenant_user_roles USING btree (tenant_id);

-- INDEX: idx_tenants_created_at
-- 末尾の id はテナント一覧の cursor のタイブレーカー。btree は逆順にも
-- 走査できるので、この 1 本で次ページと前ページの両方を索引順に取り出せる。
CREATE INDEX idx_tenants_created_at ON tenants USING btree (created_at DESC, id DESC);

-- INDEX: idx_user_email_change_tokens_tenant_current_token
CREATE INDEX idx_user_email_change_tokens_tenant_current_token ON user_email_change_tokens USING btree (tenant_id, current_email_token_hash);

-- INDEX: idx_user_email_change_tokens_tenant_new_token
CREATE INDEX idx_user_email_change_tokens_tenant_new_token ON user_email_change_tokens USING btree (tenant_id, new_email_token_hash);

-- INDEX: idx_user_email_change_tokens_user_id
CREATE INDEX idx_user_email_change_tokens_user_id ON user_email_change_tokens USING btree (user_id);

-- INDEX: idx_user_email_verification_tokens_tenant_token
CREATE INDEX idx_user_email_verification_tokens_tenant_token ON user_email_verification_tokens USING btree (tenant_id, token_hash);

-- INDEX: idx_user_email_verification_tokens_user_id
CREATE INDEX idx_user_email_verification_tokens_user_id ON user_email_verification_tokens USING btree (user_id);

-- INDEX: idx_user_password_reset_tokens_tenant_token
CREATE INDEX idx_user_password_reset_tokens_tenant_token ON user_password_reset_tokens USING btree (tenant_id, token_hash);

-- INDEX: idx_user_password_reset_tokens_user_id
CREATE INDEX idx_user_password_reset_tokens_user_id ON user_password_reset_tokens USING btree (user_id);

-- INDEX: idx_users_tenant_created_at
CREATE INDEX idx_users_tenant_created_at ON users USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: idx_users_tenant_id_email
CREATE UNIQUE INDEX idx_users_tenant_id_email ON users USING btree (tenant_id, email) WHERE (tenant_id IS NOT NULL);

-- INDEX: uq_label_image_variants_label_image_type_width
CREATE UNIQUE INDEX uq_label_image_variants_label_image_type_width ON label_image_variants USING btree (label_image_id, variant_type, width);

-- INDEX: uq_series_image_variants_series_image_type_width
CREATE UNIQUE INDEX uq_series_image_variants_series_image_type_width ON series_image_variants USING btree (series_image_id, variant_type, width);

-- FK CONSTRAINT: access_tickets access_tickets_created_by_user_id_fkey
-- Single-column on purpose: multi-column FK with ON DELETE SET NULL would also null tenant_id.
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;

-- FK CONSTRAINT: access_tickets access_tickets_tenant_id_fkey
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: access_tickets access_tickets_tenant_episode_id_fkey
-- Composite FK prevents referencing an episode that belongs to another tenant.
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: access_tickets access_tickets_tenant_user_id_fkey
-- Composite FK prevents referencing a user that belongs to another tenant.
ALTER TABLE ONLY access_tickets
    ADD CONSTRAINT access_tickets_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: audit_logs audit_logs_actor_user_id_fkey
ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES users(id);

-- FK CONSTRAINT: audit_logs audit_logs_tenant_id_fkey
ALTER TABLE ONLY audit_logs
    ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_image_variants creator_image_variants_creator_image_id_fkey
ALTER TABLE ONLY creator_image_variants
    ADD CONSTRAINT creator_image_variants_creator_image_id_fkey FOREIGN KEY (creator_image_id) REFERENCES creator_images(id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_image_variants creator_image_variants_tenant_id_fkey
ALTER TABLE ONLY creator_image_variants
    ADD CONSTRAINT creator_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_images creator_images_creator_id_fkey
ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE;

-- FK CONSTRAINT: creator_images creator_images_tenant_id_fkey
ALTER TABLE ONLY creator_images
    ADD CONSTRAINT creator_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: creators creators_icon_image_id_fkey
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_icon_image_id_fkey FOREIGN KEY (icon_image_id) REFERENCES creator_images(id) ON DELETE SET NULL;

-- FK CONSTRAINT: creators creators_tenant_id_fkey
ALTER TABLE ONLY creators
    ADD CONSTRAINT creators_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_image_variants episode_image_variants_episode_image_id_fkey
ALTER TABLE ONLY episode_image_variants
    ADD CONSTRAINT episode_image_variants_episode_image_id_fkey FOREIGN KEY (episode_image_id) REFERENCES episode_images(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_images episode_images_episode_id_fkey
ALTER TABLE ONLY episode_images
    ADD CONSTRAINT episode_images_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_images episode_images_tenant_id_fkey
ALTER TABLE ONLY episode_images
    ADD CONSTRAINT episode_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episode_listings episode_listings_episode_id_fkey
ALTER TABLE ONLY episode_listings
    ADD CONSTRAINT episode_listings_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episodes episodes_series_id_fkey
ALTER TABLE ONLY episodes
    ADD CONSTRAINT episodes_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id);

-- FK CONSTRAINT: episode_listings fk_episode_listings_tenant_id
ALTER TABLE ONLY episode_listings
    ADD CONSTRAINT fk_episode_listings_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: episodes fk_episodes_tenant_id
ALTER TABLE ONLY episodes
    ADD CONSTRAINT fk_episodes_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: page_versions fk_page_versions_tenant_id
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT fk_page_versions_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: purchases fk_purchases_tenant_id
ALTER TABLE ONLY purchases
    ADD CONSTRAINT fk_purchases_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_creators fk_series_creators_tenant_id
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT fk_series_creators_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_listings fk_series_listings_tenant_id
ALTER TABLE ONLY series_listings
    ADD CONSTRAINT fk_series_listings_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_user_roles fk_tenant_user_roles_tenant_id
ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT fk_tenant_user_roles_tenant_id FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: label_image_variants label_image_variants_label_image_id_fkey
ALTER TABLE ONLY label_image_variants
    ADD CONSTRAINT label_image_variants_label_image_id_fkey FOREIGN KEY (label_image_id) REFERENCES label_images(id) ON DELETE CASCADE;

-- FK CONSTRAINT: label_image_variants label_image_variants_tenant_id_fkey
ALTER TABLE ONLY label_image_variants
    ADD CONSTRAINT label_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: label_images label_images_label_id_fkey
ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_label_id_fkey FOREIGN KEY (label_id) REFERENCES labels(id) ON DELETE CASCADE;

-- FK CONSTRAINT: label_images label_images_tenant_id_fkey
ALTER TABLE ONLY label_images
    ADD CONSTRAINT label_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: labels labels_eye_catch_image_id_fkey
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_eye_catch_image_id_fkey FOREIGN KEY (eye_catch_image_id) REFERENCES label_images(id) ON DELETE SET NULL;

-- FK CONSTRAINT: labels labels_tenant_id_fkey
ALTER TABLE ONLY labels
    ADD CONSTRAINT labels_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcement_reads announcement_reads_announcement_id_fkey
ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_announcement_id_fkey FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcement_reads announcement_reads_user_id_fkey
ALTER TABLE ONLY announcement_reads
    ADD CONSTRAINT announcement_reads_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcements announcements_target_user_id_fkey
ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: announcements announcements_tenant_id_fkey
ALTER TABLE ONLY announcements
    ADD CONSTRAINT announcements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: page_versions page_versions_author_user_id_fkey
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_author_user_id_fkey FOREIGN KEY (author_user_id) REFERENCES users(id);

-- FK CONSTRAINT: page_versions page_versions_page_id_fkey
ALTER TABLE ONLY page_versions
    ADD CONSTRAINT page_versions_page_id_fkey FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE;

-- FK CONSTRAINT: pages pages_published_version_id_fkey
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_published_version_id_fkey FOREIGN KEY (published_version_id) REFERENCES page_versions(id) ON DELETE SET NULL;

-- FK CONSTRAINT: pages pages_tenant_id_fkey
ALTER TABLE ONLY pages
    ADD CONSTRAINT pages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: platform_audit_logs platform_audit_logs_actor_platform_user_id_fkey
ALTER TABLE ONLY platform_audit_logs
    ADD CONSTRAINT platform_audit_logs_actor_platform_user_id_fkey FOREIGN KEY (actor_platform_user_id) REFERENCES platform_users(id);

-- FK CONSTRAINT: platform_user_email_change_tokens platform_user_email_change_tokens_platform_user_id_fkey
ALTER TABLE ONLY platform_user_email_change_tokens
    ADD CONSTRAINT platform_user_email_change_tokens_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: platform_user_password_reset_tokens platform_user_password_reset_tokens_platform_user_id_fkey
ALTER TABLE ONLY platform_user_password_reset_tokens
    ADD CONSTRAINT platform_user_password_reset_tokens_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: platform_user_roles platform_user_roles_platform_user_id_fkey
ALTER TABLE ONLY platform_user_roles
    ADD CONSTRAINT platform_user_roles_platform_user_id_fkey FOREIGN KEY (platform_user_id) REFERENCES platform_users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: purchases purchases_episode_id_fkey
ALTER TABLE ONLY purchases
    ADD CONSTRAINT purchases_episode_id_fkey FOREIGN KEY (episode_id) REFERENCES episodes(id);

-- FK CONSTRAINT: series_creators series_creators_creator_id_fkey
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_creator_id_fkey FOREIGN KEY (creator_id) REFERENCES creators(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_creators series_creators_series_id_fkey
ALTER TABLE ONLY series_creators
    ADD CONSTRAINT series_creators_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series series_eye_catch_image_id_fkey
ALTER TABLE ONLY series
    ADD CONSTRAINT series_eye_catch_image_id_fkey FOREIGN KEY (eye_catch_image_id) REFERENCES series_images(id) ON DELETE SET NULL;

-- FK CONSTRAINT: series_image_variants series_image_variants_series_image_id_fkey
ALTER TABLE ONLY series_image_variants
    ADD CONSTRAINT series_image_variants_series_image_id_fkey FOREIGN KEY (series_image_id) REFERENCES series_images(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_image_variants series_image_variants_tenant_id_fkey
ALTER TABLE ONLY series_image_variants
    ADD CONSTRAINT series_image_variants_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_images series_images_series_id_fkey
ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_images series_images_tenant_id_fkey
ALTER TABLE ONLY series_images
    ADD CONSTRAINT series_images_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series series_label_id_fkey
ALTER TABLE ONLY series
    ADD CONSTRAINT series_label_id_fkey FOREIGN KEY (label_id) REFERENCES labels(id);

-- FK CONSTRAINT: series_listings series_listings_series_id_fkey
ALTER TABLE ONLY series_listings
    ADD CONSTRAINT series_listings_series_id_fkey FOREIGN KEY (series_id) REFERENCES series(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series series_tenant_id_fkey
ALTER TABLE ONLY series
    ADD CONSTRAINT series_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id);

-- FK CONSTRAINT: tenant_admin_invitations tenant_admin_invitations_tenant_id_fkey
ALTER TABLE ONLY tenant_admin_invitations
    ADD CONSTRAINT tenant_admin_invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_config tenant_config_tenant_id_fkey
ALTER TABLE ONLY tenant_config
    ADD CONSTRAINT tenant_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_smtp_config tenant_smtp_config_tenant_id_fkey
ALTER TABLE ONLY tenant_smtp_config
    ADD CONSTRAINT tenant_smtp_config_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_themes tenant_themes_tenant_id_fkey
ALTER TABLE ONLY tenant_themes
    ADD CONSTRAINT tenant_themes_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_user_roles tenant_user_roles_user_id_fkey
ALTER TABLE ONLY tenant_user_roles
    ADD CONSTRAINT tenant_user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_email_change_tokens user_email_change_tokens_tenant_id_fkey
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_email_change_tokens user_email_change_tokens_user_id_fkey
ALTER TABLE ONLY user_email_change_tokens
    ADD CONSTRAINT user_email_change_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_tenant_id_fkey
ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_email_verification_tokens user_email_verification_tokens_user_id_fkey
ALTER TABLE ONLY user_email_verification_tokens
    ADD CONSTRAINT user_email_verification_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_notification_settings user_notification_settings_user_id_fkey
ALTER TABLE ONLY user_notification_settings
    ADD CONSTRAINT user_notification_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_tenant_id_fkey
ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: user_password_reset_tokens user_password_reset_tokens_user_id_fkey
ALTER TABLE ONLY user_password_reset_tokens
    ADD CONSTRAINT user_password_reset_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- FK CONSTRAINT: users users_tenant_id_fkey
ALTER TABLE ONLY users
    ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: access_tickets
ALTER TABLE access_tickets ENABLE ROW LEVEL SECURITY;

-- POLICY: access_tickets access_tickets_tenant_isolation
CREATE POLICY access_tickets_tenant_isolation ON access_tickets USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: audit_logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- POLICY: audit_logs audit_logs_tenant_isolation
CREATE POLICY audit_logs_tenant_isolation ON audit_logs USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: creator_image_variants
ALTER TABLE creator_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: creator_image_variants creator_image_variants_tenant_isolation
CREATE POLICY creator_image_variants_tenant_isolation ON creator_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: creator_images
ALTER TABLE creator_images ENABLE ROW LEVEL SECURITY;

-- POLICY: creator_images creator_images_tenant_isolation
CREATE POLICY creator_images_tenant_isolation ON creator_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: creators
ALTER TABLE creators ENABLE ROW LEVEL SECURITY;

-- POLICY: creators creators_tenant_isolation
CREATE POLICY creators_tenant_isolation ON creators USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: episode_images
ALTER TABLE episode_images ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_images episode_images_tenant_isolation
CREATE POLICY episode_images_tenant_isolation ON episode_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: episode_listings
ALTER TABLE episode_listings ENABLE ROW LEVEL SECURITY;

-- POLICY: episode_listings episode_listings_tenant_isolation
CREATE POLICY episode_listings_tenant_isolation ON episode_listings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: episodes
ALTER TABLE episodes ENABLE ROW LEVEL SECURITY;

-- POLICY: episodes episodes_tenant_isolation
CREATE POLICY episodes_tenant_isolation ON episodes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: label_image_variants
ALTER TABLE label_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: label_image_variants label_image_variants_tenant_isolation
CREATE POLICY label_image_variants_tenant_isolation ON label_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: label_images
ALTER TABLE label_images ENABLE ROW LEVEL SECURITY;

-- POLICY: label_images label_images_tenant_isolation
CREATE POLICY label_images_tenant_isolation ON label_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: labels
ALTER TABLE labels ENABLE ROW LEVEL SECURITY;

-- POLICY: labels labels_tenant_isolation
CREATE POLICY labels_tenant_isolation ON labels USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: page_versions
ALTER TABLE page_versions ENABLE ROW LEVEL SECURITY;

-- POLICY: page_versions page_versions_tenant_isolation
CREATE POLICY page_versions_tenant_isolation ON page_versions USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: pages
ALTER TABLE pages ENABLE ROW LEVEL SECURITY;

-- POLICY: pages pages_tenant_isolation
CREATE POLICY pages_tenant_isolation ON pages USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: purchases
ALTER TABLE purchases ENABLE ROW LEVEL SECURITY;

-- POLICY: purchases purchases_tenant_isolation
CREATE POLICY purchases_tenant_isolation ON purchases USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: series
ALTER TABLE series ENABLE ROW LEVEL SECURITY;

-- ROW SECURITY: series_creators
ALTER TABLE series_creators ENABLE ROW LEVEL SECURITY;

-- POLICY: series_creators series_creators_tenant_isolation
CREATE POLICY series_creators_tenant_isolation ON series_creators USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: series_image_variants
ALTER TABLE series_image_variants ENABLE ROW LEVEL SECURITY;

-- POLICY: series_image_variants series_image_variants_tenant_isolation
CREATE POLICY series_image_variants_tenant_isolation ON series_image_variants USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: series_images
ALTER TABLE series_images ENABLE ROW LEVEL SECURITY;

-- POLICY: series_images series_images_tenant_isolation
CREATE POLICY series_images_tenant_isolation ON series_images USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: series_listings
ALTER TABLE series_listings ENABLE ROW LEVEL SECURITY;

-- POLICY: series_listings series_listings_tenant_isolation
CREATE POLICY series_listings_tenant_isolation ON series_listings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- POLICY: series series_tenant_isolation
CREATE POLICY series_tenant_isolation ON series USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: tenant_admin_invitations
ALTER TABLE tenant_admin_invitations ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_admin_invitations tenant_admin_invitations_tenant_isolation
CREATE POLICY tenant_admin_invitations_tenant_isolation ON tenant_admin_invitations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: tenant_config
ALTER TABLE tenant_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_config tenant_config_tenant_isolation
CREATE POLICY tenant_config_tenant_isolation ON tenant_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: tenant_smtp_config
ALTER TABLE tenant_smtp_config ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_smtp_config tenant_smtp_config_tenant_isolation
CREATE POLICY tenant_smtp_config_tenant_isolation ON tenant_smtp_config USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: tenant_themes
ALTER TABLE tenant_themes ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_themes tenant_themes_tenant_isolation
CREATE POLICY tenant_themes_tenant_isolation ON tenant_themes USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: tenant_user_roles
ALTER TABLE tenant_user_roles ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_user_roles tenant_user_roles_tenant_isolation
CREATE POLICY tenant_user_roles_tenant_isolation ON tenant_user_roles USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: user_email_change_tokens
ALTER TABLE user_email_change_tokens ENABLE ROW LEVEL SECURITY;

-- POLICY: user_email_change_tokens user_email_change_tokens_tenant_isolation
CREATE POLICY user_email_change_tokens_tenant_isolation ON user_email_change_tokens USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: user_email_verification_tokens
ALTER TABLE user_email_verification_tokens ENABLE ROW LEVEL SECURITY;

-- POLICY: user_email_verification_tokens user_email_verification_tokens_tenant_isolation
CREATE POLICY user_email_verification_tokens_tenant_isolation ON user_email_verification_tokens USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: user_password_reset_tokens
ALTER TABLE user_password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- POLICY: user_password_reset_tokens user_password_reset_tokens_tenant_isolation
CREATE POLICY user_password_reset_tokens_tenant_isolation ON user_password_reset_tokens USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- ROW SECURITY: users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- POLICY: users users_tenant_isolation
CREATE POLICY users_tenant_isolation ON users USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
