-- Free after publication: a series an editor opts in makes each of its priced
-- episodes free to everyone a set number of days after the episode was
-- published, keeping the newest ones for buyers. The worker turns the rule
-- into ordinary episode_free_windows rows, so every read that decides access,
-- every cache, and the search index see windows they already understand.

-- TABLE: series_free_after_settings
-- One series' free-after-publication rule. No row reads as the column
-- defaults, which leave the rule off, so a series nobody configured needs no
-- row.
CREATE TABLE series_free_after_settings (
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    -- How many days after an episode is published it becomes free.
    days_after_publication integer DEFAULT 30 NOT NULL,
    -- How many of the series' latest published episodes the rule leaves
    -- priced, so the newest ones still sell.
    excluded_latest_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    -- Ten years bounds the wait: past it the number is a typo rather than a
    -- rule, and an instant computed from it stays well inside timestamptz.
    CONSTRAINT series_free_after_settings_days_after_publication_check CHECK ((days_after_publication BETWEEN 1 AND 3650)),
    CONSTRAINT series_free_after_settings_excluded_latest_count_check CHECK ((excluded_latest_count >= 0))
);

-- CONSTRAINT: series_free_after_settings series_free_after_settings_pkey
ALTER TABLE ONLY series_free_after_settings
    ADD CONSTRAINT series_free_after_settings_pkey PRIMARY KEY (series_id);

-- FK CONSTRAINT: series_free_after_settings series_free_after_settings_tenant_id_fkey
ALTER TABLE ONLY series_free_after_settings
    ADD CONSTRAINT series_free_after_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_free_after_settings series_free_after_settings_tenant_series_id_fkey
-- Composite FK prevents configuring a series that belongs to another tenant.
ALTER TABLE ONLY series_free_after_settings
    ADD CONSTRAINT series_free_after_settings_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_series_free_after_settings_tenant_id
CREATE INDEX idx_series_free_after_settings_tenant_id ON series_free_after_settings USING btree (tenant_id);

-- INDEX: idx_series_free_after_settings_enabled
-- The worker's pass reads the rules that are on, across every tenant, and
-- most series never turn one on.
CREATE INDEX idx_series_free_after_settings_enabled ON series_free_after_settings USING btree (series_id)
    WHERE enabled;

-- ROW SECURITY: series_free_after_settings
ALTER TABLE series_free_after_settings ENABLE ROW LEVEL SECURITY;

-- POLICY: series_free_after_settings series_free_after_settings_tenant_isolation
CREATE POLICY series_free_after_settings_tenant_isolation ON series_free_after_settings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: episode_free_windows.rule_series_id
-- The series whose free-after-publication rule wrote the window, and NULL on
-- one an editor scheduled. A rule's window ends at the far end the check
-- below names, so every predicate that compares ends_at against NOW(), the
-- previous release's included, reads it as open.
ALTER TABLE episode_free_windows
    ADD COLUMN rule_series_id uuid;

-- CONSTRAINT: episode_free_windows episode_free_windows_rule_ends_check
-- A rule's window ends when the rule is turned off, which deletes it, so the
-- far end is the only end it carries.
ALTER TABLE ONLY episode_free_windows
    ADD CONSTRAINT episode_free_windows_rule_ends_check CHECK (((rule_series_id IS NULL) OR (ends_at = '9999-12-31 00:00:00+00'::timestamp with time zone)));

-- FK CONSTRAINT: episode_free_windows episode_free_windows_tenant_rule_series_id_fkey
-- Composite FK prevents naming another tenant's series. MATCH SIMPLE leaves a
-- window scheduled by hand, whose rule_series_id is NULL, outside it.
ALTER TABLE ONLY episode_free_windows
    ADD CONSTRAINT episode_free_windows_tenant_rule_series_id_fkey FOREIGN KEY (tenant_id, rule_series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;
