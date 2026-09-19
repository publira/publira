CREATE TABLE tenant_royalty_config (
    tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    close_mode text NOT NULL DEFAULT 'manual',
    auto_close_day integer,
    automatic_since timestamp with time zone,
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT tenant_royalty_config_close_mode_check CHECK (close_mode IN ('manual', 'automatic')),
    CONSTRAINT tenant_royalty_config_auto_close_day_check CHECK (auto_close_day IS NULL OR auto_close_day BETWEEN 1 AND 28),
    CONSTRAINT tenant_royalty_config_automatic_requires_day CHECK (close_mode <> 'automatic' OR auto_close_day IS NOT NULL)
);

ALTER TABLE tenant_royalty_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_royalty_config_tenant_isolation ON tenant_royalty_config
    USING (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
    WITH CHECK (tenant_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
