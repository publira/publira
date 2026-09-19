-- TABLE: platform_retention_config
--
-- How long withdrawn comments, content events, and ranking snapshots are kept
-- when a tenant sets nothing of its own. No value column has a default: a
-- missing row means nothing is saved, and the server answers it with its
-- built-in defaults.
CREATE TABLE platform_retention_config (
    singleton boolean DEFAULT true NOT NULL,
    withdrawn_comment_days integer NOT NULL,
    content_event_days integer NOT NULL,
    daily_ranking_snapshot_days integer NOT NULL,
    weekly_ranking_snapshot_days integer NOT NULL,
    -- Moves with every write, so a save can state which version it is based on.
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT platform_retention_config_singleton_check CHECK (singleton),
    CONSTRAINT platform_retention_config_revision_positive_check CHECK ((revision > 0)),
    -- A window of zero or less puts the cutoff at or after now and takes every
    -- row with it; the upper bound keeps the cutoff a date PostgreSQL can hold.
    CONSTRAINT platform_retention_config_withdrawn_comment_days_check CHECK (((withdrawn_comment_days >= 1) AND (withdrawn_comment_days <= 36500))),
    CONSTRAINT platform_retention_config_content_event_days_check CHECK (((content_event_days >= 1) AND (content_event_days <= 36500))),
    CONSTRAINT platform_retention_config_daily_ranking_snapshot_days_check CHECK (((daily_ranking_snapshot_days >= 1) AND (daily_ranking_snapshot_days <= 36500))),
    CONSTRAINT platform_retention_config_weekly_ranking_snapshot_days_check CHECK (((weekly_ranking_snapshot_days >= 1) AND (weekly_ranking_snapshot_days <= 36500)))
);

-- CONSTRAINT: platform_retention_config platform_retention_config_pkey
ALTER TABLE ONLY platform_retention_config
    ADD CONSTRAINT platform_retention_config_pkey PRIMARY KEY (singleton);

-- TABLE: tenant_retention_settings
--
-- A tenant's own retention periods. A NULL column follows the platform
-- default, so a tenant that overrides one period keeps tracking the others.
CREATE TABLE tenant_retention_settings (
    tenant_id uuid NOT NULL,
    withdrawn_comment_days integer,
    content_event_days integer,
    daily_ranking_snapshot_days integer,
    weekly_ranking_snapshot_days integer,
    -- Moves with every write, so a save can state which version it is based on.
    revision bigint DEFAULT 1 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_retention_settings_revision_positive_check CHECK ((revision > 0)),
    CONSTRAINT tenant_retention_settings_withdrawn_comment_days_check CHECK (((withdrawn_comment_days >= 1) AND (withdrawn_comment_days <= 36500))),
    CONSTRAINT tenant_retention_settings_content_event_days_check CHECK (((content_event_days >= 1) AND (content_event_days <= 36500))),
    CONSTRAINT tenant_retention_settings_daily_ranking_snapshot_days_check CHECK (((daily_ranking_snapshot_days >= 1) AND (daily_ranking_snapshot_days <= 36500))),
    CONSTRAINT tenant_retention_settings_weekly_ranking_snapshot_days_check CHECK (((weekly_ranking_snapshot_days >= 1) AND (weekly_ranking_snapshot_days <= 36500)))
);

-- CONSTRAINT: tenant_retention_settings tenant_retention_settings_pkey
ALTER TABLE ONLY tenant_retention_settings
    ADD CONSTRAINT tenant_retention_settings_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_retention_settings tenant_retention_settings_tenant_id_fkey
ALTER TABLE ONLY tenant_retention_settings
    ADD CONSTRAINT tenant_retention_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_retention_settings
ALTER TABLE tenant_retention_settings ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_retention_settings tenant_retention_settings_tenant_isolation
CREATE POLICY tenant_retention_settings_tenant_isolation ON tenant_retention_settings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
