-- Wait-for-free: a series an editor opts in lets each signed-in reader open one
-- priced episode of it for a while, once per recharge interval. The opening is
-- an access_tickets row like a staff-issued one, so every read that decides
-- access already honours it through episode_content_grants.

-- TABLE: series_wait_free_settings
-- One series' wait-for-free rule. No row reads as the column defaults, which
-- leave the rule off, so a series nobody configured needs no row.
CREATE TABLE series_wait_free_settings (
    tenant_id uuid NOT NULL,
    series_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    -- How long after a reader uses a ticket on this series the next one is ready.
    recharge_hours integer DEFAULT 23 NOT NULL,
    -- How long the episode a ticket opens stays open.
    access_hours integer DEFAULT 72 NOT NULL,
    -- How many of the series' latest published episodes a ticket cannot open,
    -- so the newest ones still sell.
    excluded_latest_count integer DEFAULT 0 NOT NULL,
    -- A year bounds both periods: past it the number is a typo rather than a
    -- rule, and an instant computed from it stays well inside timestamptz.
    CONSTRAINT series_wait_free_settings_recharge_hours_check CHECK ((recharge_hours BETWEEN 1 AND 8760)),
    CONSTRAINT series_wait_free_settings_access_hours_check CHECK ((access_hours BETWEEN 1 AND 8760)),
    CONSTRAINT series_wait_free_settings_excluded_latest_count_check CHECK ((excluded_latest_count >= 0))
);

-- CONSTRAINT: series_wait_free_settings series_wait_free_settings_pkey
ALTER TABLE ONLY series_wait_free_settings
    ADD CONSTRAINT series_wait_free_settings_pkey PRIMARY KEY (series_id);

-- FK CONSTRAINT: series_wait_free_settings series_wait_free_settings_tenant_id_fkey
ALTER TABLE ONLY series_wait_free_settings
    ADD CONSTRAINT series_wait_free_settings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: series_wait_free_settings series_wait_free_settings_tenant_series_id_fkey
-- Composite FK prevents configuring a series that belongs to another tenant.
ALTER TABLE ONLY series_wait_free_settings
    ADD CONSTRAINT series_wait_free_settings_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_series_wait_free_settings_tenant_id
CREATE INDEX idx_series_wait_free_settings_tenant_id ON series_wait_free_settings USING btree (tenant_id);

-- ROW SECURITY: series_wait_free_settings
ALTER TABLE series_wait_free_settings ENABLE ROW LEVEL SECURITY;

-- POLICY: series_wait_free_settings series_wait_free_settings_tenant_isolation
CREATE POLICY series_wait_free_settings_tenant_isolation ON series_wait_free_settings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: wait_free_ticket_states
-- When one reader's next ticket on one series is ready. The instant is fixed
-- when a ticket is used, from the recharge interval in force then, so an editor
-- changing the interval moves the next use rather than the one already waiting.
-- No row means the reader has never used one, and a ticket is ready.
--
-- The row is also what serializes a reader's uses: claiming a ticket is one
-- conditional upsert on it, so two requests at once cannot both spend the same
-- recharge.
CREATE TABLE wait_free_ticket_states (
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    series_id uuid NOT NULL,
    next_available_at timestamp with time zone NOT NULL
);

-- CONSTRAINT: wait_free_ticket_states wait_free_ticket_states_pkey
ALTER TABLE ONLY wait_free_ticket_states
    ADD CONSTRAINT wait_free_ticket_states_pkey PRIMARY KEY (tenant_id, user_id, series_id);

-- FK CONSTRAINT: wait_free_ticket_states wait_free_ticket_states_tenant_id_fkey
ALTER TABLE ONLY wait_free_ticket_states
    ADD CONSTRAINT wait_free_ticket_states_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: wait_free_ticket_states wait_free_ticket_states_tenant_user_id_fkey
-- Composite FK prevents referencing a reader that belongs to another tenant.
ALTER TABLE ONLY wait_free_ticket_states
    ADD CONSTRAINT wait_free_ticket_states_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: wait_free_ticket_states wait_free_ticket_states_tenant_series_id_fkey
-- Composite FK prevents referencing a series that belongs to another tenant.
ALTER TABLE ONLY wait_free_ticket_states
    ADD CONSTRAINT wait_free_ticket_states_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_wait_free_ticket_states_tenant_series_id
-- The referencing side of the series foreign key: deleting a series would
-- otherwise scan every reader's state.
CREATE INDEX idx_wait_free_ticket_states_tenant_series_id ON wait_free_ticket_states USING btree (tenant_id, series_id);

-- ROW SECURITY: wait_free_ticket_states
ALTER TABLE wait_free_ticket_states ENABLE ROW LEVEL SECURITY;

-- POLICY: wait_free_ticket_states wait_free_ticket_states_tenant_isolation
CREATE POLICY wait_free_ticket_states_tenant_isolation ON wait_free_ticket_states USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: access_tickets source
-- Who opened the episode: staff issuing a ticket from the console, or the
-- reader spending a wait-for-free ticket. The default is what every row
-- written before this column existed was.
--
-- NOT VALID keeps this statement from scanning the table under its ACCESS
-- EXCLUSIVE lock; the next migration validates the rows that are already
-- there.
ALTER TABLE ONLY access_tickets
    ADD COLUMN source text DEFAULT 'staff'::text NOT NULL,
    ADD CONSTRAINT access_tickets_source_check CHECK ((source = ANY (ARRAY['staff'::text, 'wait_free'::text]))) NOT VALID;
