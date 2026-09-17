-- Monthly royalty statements: one tenant month of sales, closed into what each
-- credited creator is owed. A statement is written once and never updated, so
-- editing a share, renaming a creator or refunding a sale afterwards leaves a
-- closed month exactly as it was closed.

-- TABLE: royalty_statements
-- The header of one closed month.
CREATE TABLE royalty_statements (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    -- The first day of the month the statement covers. The month is the
    -- tenant's calendar month in time_zone.
    period date NOT NULL,
    -- The zone the month was cut in, kept because the tenant may change its
    -- own zone later and the boundaries have to stay recomputable by hand.
    time_zone text NOT NULL,
    closed_at timestamp with time zone DEFAULT now() NOT NULL,
    -- NULL for a close no user started, and after the closing account is
    -- deleted; audit_logs keeps who closed it.
    closed_by_user_id uuid,
    -- What the month sold, counting each sale once however many creators it
    -- is credited to. Refunded sales are not in it; refunded_amount is the
    -- partial refunds of the sales that are.
    total_gross bigint NOT NULL,
    total_refunded bigint NOT NULL,
    total_payout bigint NOT NULL,
    CONSTRAINT royalty_statements_period_check CHECK ((period = date_trunc('month', period)::date)),
    CONSTRAINT royalty_statements_amounts_check CHECK (((total_gross >= 0) AND (total_refunded >= 0) AND (total_payout >= 0)))
);

-- CONSTRAINT: royalty_statements royalty_statements_pkey
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_pkey PRIMARY KEY (id);

-- CONSTRAINT: royalty_statements royalty_statements_tenant_id_period_key
-- A month is closed once. This is also what makes a manual and an automatic
-- close of the same month fail instead of writing two statements.
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_tenant_id_period_key UNIQUE (tenant_id, period);

-- CONSTRAINT: royalty_statements royalty_statements_tenant_id_id_key
-- Enables composite FKs that keep lines on the same tenant as their statement.
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: royalty_statements royalty_statements_tenant_id_fkey
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: royalty_statements royalty_statements_tenant_closed_by_user_id_fkey
-- SET NULL lists the column so the action does not null tenant_id as well.
ALTER TABLE ONLY royalty_statements
    ADD CONSTRAINT royalty_statements_tenant_closed_by_user_id_fkey FOREIGN KEY (tenant_id, closed_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (closed_by_user_id);

-- ROW SECURITY: royalty_statements
ALTER TABLE royalty_statements ENABLE ROW LEVEL SECURITY;

-- POLICY: royalty_statements royalty_statements_tenant_isolation
CREATE POLICY royalty_statements_tenant_isolation ON royalty_statements USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: royalty_statement_lines
-- One line per creator × episode × role credited on a sale of the month. The
-- catalog rows a line points at can be deleted later, so the line carries the
-- names it is read with and its references fall to NULL.
CREATE TABLE royalty_statement_lines (
    tenant_id uuid NOT NULL,
    statement_id uuid NOT NULL,
    -- The line's position in the statement, starting at 1.
    line_number integer NOT NULL,
    creator_id uuid,
    creator_name text NOT NULL,
    series_id uuid,
    series_title text NOT NULL,
    episode_id uuid,
    episode_title text NOT NULL,
    role_id uuid,
    -- NULL for a credit that states no role.
    role_name text,
    sale_count integer NOT NULL,
    gross_amount bigint NOT NULL,
    refunded_amount bigint NOT NULL,
    -- The share as it stood on the credit at close.
    share_bps integer NOT NULL,
    payout_amount bigint NOT NULL,
    CONSTRAINT royalty_statement_lines_line_number_check CHECK ((line_number > 0)),
    CONSTRAINT royalty_statement_lines_amounts_check CHECK (((sale_count > 0) AND (refunded_amount >= 0) AND (gross_amount >= refunded_amount))),
    CONSTRAINT royalty_statement_lines_share_bps_check CHECK (((share_bps >= 0) AND (share_bps <= 10000))),
    -- The payout is the line's net sales times the share, floored to whole
    -- yen, so every closed figure can be recomputed from the line alone.
    CONSTRAINT royalty_statement_lines_payout_check CHECK ((payout_amount = (((gross_amount - refunded_amount) * share_bps) / 10000)))
);

-- CONSTRAINT: royalty_statement_lines royalty_statement_lines_pkey
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_pkey PRIMARY KEY (statement_id, line_number);

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_statement_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_statement_id_fkey FOREIGN KEY (tenant_id, statement_id) REFERENCES royalty_statements(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_creator_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_creator_id_fkey FOREIGN KEY (tenant_id, creator_id) REFERENCES creators(tenant_id, id) ON DELETE SET NULL (creator_id);

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_series_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE SET NULL (series_id);

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_episode_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_episode_id_fkey FOREIGN KEY (tenant_id, episode_id) REFERENCES episodes(tenant_id, id) ON DELETE SET NULL (episode_id);

-- FK CONSTRAINT: royalty_statement_lines royalty_statement_lines_tenant_role_id_fkey
ALTER TABLE ONLY royalty_statement_lines
    ADD CONSTRAINT royalty_statement_lines_tenant_role_id_fkey FOREIGN KEY (tenant_id, role_id) REFERENCES creator_roles(tenant_id, id) ON DELETE SET NULL (role_id);

-- ROW SECURITY: royalty_statement_lines
ALTER TABLE royalty_statement_lines ENABLE ROW LEVEL SECURITY;

-- POLICY: royalty_statement_lines royalty_statement_lines_tenant_isolation
CREATE POLICY royalty_statement_lines_tenant_isolation ON royalty_statement_lines USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- FUNCTION: royalty_statements_refuse_changes
-- A closed statement is what a publisher pays from, so no role may rewrite or
-- remove one, the platform role that bypasses RLS included. The one change let
-- through is a referential action — a deleted creator nulling its reference, a
-- deleted tenant taking its statements along — which runs inside the foreign
-- key's own trigger and so arrives nested one level deeper.
CREATE FUNCTION royalty_statements_refuse_changes() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        IF TG_OP = 'DELETE' THEN
            RETURN OLD;
        END IF;
        RETURN NEW;
    END IF;
    RAISE EXCEPTION 'a closed royalty statement cannot be changed'
        USING ERRCODE = 'restrict_violation';
END;
$$;

-- TRIGGER: royalty_statements royalty_statements_immutable
CREATE TRIGGER royalty_statements_immutable
    BEFORE UPDATE OR DELETE ON royalty_statements
    FOR EACH ROW
    EXECUTE FUNCTION royalty_statements_refuse_changes();

-- TRIGGER: royalty_statement_lines royalty_statement_lines_immutable
CREATE TRIGGER royalty_statement_lines_immutable
    BEFORE UPDATE OR DELETE ON royalty_statement_lines
    FOR EACH ROW
    EXECUTE FUNCTION royalty_statements_refuse_changes();
