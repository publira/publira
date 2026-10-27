-- TABLE: tenant_theme_dark
-- The palette a tenant's storefront and app read in while the reader reads in
-- dark, beside the light one in tenant_themes. It holds the same colors and
-- nothing else: the fonts and the branding images are one set for both.
--
-- A tenant has no row until it saves a dark palette, and the row holds all of
-- it, so no column has a default: a tenant without one has no dark palette at
-- all rather than a stand-in for one.
CREATE TABLE tenant_theme_dark (
    tenant_id uuid NOT NULL,
    background_color character varying(32) NOT NULL,
    foreground_color character varying(32) NOT NULL,
    surface_color character varying(32) NOT NULL,
    surface_foreground_color character varying(32) NOT NULL,
    card_color character varying(32) NOT NULL,
    card_foreground_color character varying(32) NOT NULL,
    popover_color character varying(32) NOT NULL,
    popover_foreground_color character varying(32) NOT NULL,
    primary_color character varying(32) NOT NULL,
    primary_foreground_color character varying(32) NOT NULL,
    secondary_color character varying(32) NOT NULL,
    secondary_foreground_color character varying(32) NOT NULL,
    accent_color character varying(32) NOT NULL,
    accent_foreground_color character varying(32) NOT NULL,
    muted_color character varying(32) NOT NULL,
    muted_foreground_color character varying(32) NOT NULL,
    border_color character varying(32) NOT NULL,
    input_color character varying(32) NOT NULL,
    ring_color character varying(32) NOT NULL,
    success_color character varying(32) NOT NULL,
    success_foreground_color character varying(32) NOT NULL,
    warning_color character varying(32) NOT NULL,
    warning_foreground_color character varying(32) NOT NULL,
    destructive_color character varying(32) NOT NULL,
    destructive_foreground_color character varying(32) NOT NULL,
    info_color character varying(32) NOT NULL,
    info_foreground_color character varying(32) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

-- CONSTRAINT: tenant_theme_dark tenant_theme_dark_pkey
ALTER TABLE ONLY tenant_theme_dark
    ADD CONSTRAINT tenant_theme_dark_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_theme_dark tenant_theme_dark_tenant_id_fkey
ALTER TABLE ONLY tenant_theme_dark
    ADD CONSTRAINT tenant_theme_dark_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_theme_dark
ALTER TABLE tenant_theme_dark ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_theme_dark tenant_theme_dark_tenant_isolation
CREATE POLICY tenant_theme_dark_tenant_isolation ON tenant_theme_dark USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
