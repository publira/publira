-- Payment reconciliations: what one payment provider or one store recorded
-- over a period of a tenant's days, matched against the purchases the install
-- recorded, and the lines that matched nothing on the other side.
--
-- Both tables are new, so nothing here rewrites a row a running deployment
-- writes to.

-- TABLE: payment_reconciliations
-- One run over one period for one source, which is either the web payment
-- provider the purchases name in purchases.provider or the store they name in
-- purchases.store. A Tenant admin starts it from the console and the worker
-- runs it; a run of the same period and source started again replaces the
-- one before, unless that one has not finished yet.
--
-- start_date and end_date are the first and the last of the tenant's days the
-- period covers, in time_zone as it was when the run was started, and
-- starts_at and ends_at the half-open range of instants they come to.
--
-- started_at is when it was asked for. claimed_at is when a worker last took
-- it up, and a claim that grows old without a finish is the claim of a worker
-- that died mid-run, which another worker takes over. finished_at is set once
-- the run has its findings, or once it failed, with failure naming why:
-- `credentials` for credentials the source refused or that are not saved, and
-- `unavailable` for a source that could not be read.
--
-- The counts are NULL until the run succeeds: the provider's or the store's
-- records read in the period, the install's purchases in it, how many of the
-- two matched each other, and the findings written.
CREATE TABLE payment_reconciliations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    provider text,
    store text,
    start_date date NOT NULL,
    end_date date NOT NULL,
    time_zone text NOT NULL,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    claimed_at timestamp with time zone,
    finished_at timestamp with time zone,
    failure text,
    record_count integer,
    purchase_count integer,
    matched_count integer,
    finding_count integer,
    CONSTRAINT payment_reconciliations_source_check CHECK (((provider IS NULL) <> (store IS NULL))),
    CONSTRAINT payment_reconciliations_provider_check CHECK ((char_length(provider) >= 1)),
    CONSTRAINT payment_reconciliations_store_check CHECK ((store = ANY (ARRAY['app_store'::text, 'google_play'::text]))),
    CONSTRAINT payment_reconciliations_dates_check CHECK ((start_date <= end_date)),
    CONSTRAINT payment_reconciliations_period_check CHECK ((starts_at < ends_at)),
    CONSTRAINT payment_reconciliations_failure_check CHECK (((failure IS NULL) OR ((failure = ANY (ARRAY['credentials'::text, 'unavailable'::text])) AND (finished_at IS NOT NULL)))),
    CONSTRAINT payment_reconciliations_counts_check CHECK ((((record_count IS NULL) = (purchase_count IS NULL)) AND ((record_count IS NULL) = (matched_count IS NULL)) AND ((record_count IS NULL) = (finding_count IS NULL)) AND ((record_count IS NULL) OR ((finished_at IS NOT NULL) AND (failure IS NULL)))))
);

-- CONSTRAINT: payment_reconciliations payment_reconciliations_pkey
ALTER TABLE ONLY payment_reconciliations
    ADD CONSTRAINT payment_reconciliations_pkey PRIMARY KEY (id);

-- CONSTRAINT: payment_reconciliations payment_reconciliations_tenant_id_id_key
-- The target of the findings' reference to their run, which names it with its
-- tenant.
ALTER TABLE ONLY payment_reconciliations
    ADD CONSTRAINT payment_reconciliations_tenant_id_id_key UNIQUE (tenant_id, id);

-- FK CONSTRAINT: payment_reconciliations payment_reconciliations_tenant_id_fkey
ALTER TABLE ONLY payment_reconciliations
    ADD CONSTRAINT payment_reconciliations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_payment_reconciliations_tenant_source_period
-- One run per period and source, which is what makes a second run replace the
-- first. A provider's id and a store's name never coincide.
CREATE UNIQUE INDEX idx_payment_reconciliations_tenant_source_period ON payment_reconciliations USING btree (tenant_id, (COALESCE(provider, store)), start_date, end_date);

-- INDEX: idx_payment_reconciliations_tenant_started_at
-- The console's list, newest first.
CREATE INDEX idx_payment_reconciliations_tenant_started_at ON payment_reconciliations USING btree (tenant_id, started_at, id);

-- INDEX: idx_payment_reconciliations_unfinished
-- What the worker looks for on every pass.
CREATE INDEX idx_payment_reconciliations_unfinished ON payment_reconciliations USING btree (started_at)
    WHERE (finished_at IS NULL);

-- ROW SECURITY: payment_reconciliations
ALTER TABLE payment_reconciliations ENABLE ROW LEVEL SECURITY;

-- POLICY: payment_reconciliations payment_reconciliations_tenant_isolation
CREATE POLICY payment_reconciliations_tenant_isolation ON payment_reconciliations USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: payment_reconciliation_findings
-- One line of a run that matched nothing on the other side, or that matched
-- and disagrees:
--
--   - `record_unmatched`: a payment the source recorded in the period that no
--     purchase names, as a payment whose notification never arrived is.
--   - `purchase_unmatched`: a purchase made in the period whose payment the
--     source has no record of.
--   - `amount_mismatch`: a purchase and the source's record of its payment
--     that disagree on the amount, the currency, or the amount refunded.
--   - `held_refund` and `held_dispute`: a refund or a dispute of a payment no
--     purchase named when it arrived, held since before the period began, so
--     that a hold that never found its purchase does not stay in its table
--     unseen.
--
-- is_test is a line of the source's test mode or sandbox, which is matched
-- only with the other side's test lines. A hold names no mode, and is listed
-- as live.
--
-- purchase_id is the purchase the line is about, if any. It has no foreign key,
-- as a royalty statement's rows have none: the finding is a record of the run
-- and keeps the ID it found. provider_payment_id is the source's own ID of the
-- payment, as the purchase stores it, so the line can be found in the
-- source's dashboard. The amounts are in the minor unit of their currency,
-- each side's as that side records it, and NULL where the side has nothing:
-- no purchase, no record, or a record that carries no amount.
--
-- occurred_at is when the line happened: the purchase, the source's payment,
-- or the arrival of the hold.
CREATE TABLE payment_reconciliation_findings (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    reconciliation_id uuid NOT NULL,
    kind text NOT NULL,
    is_test boolean NOT NULL,
    purchase_id uuid,
    provider_payment_id text,
    purchase_amount bigint,
    purchase_refunded_amount bigint,
    purchase_currency text,
    record_amount bigint,
    record_refunded_amount bigint,
    record_currency text,
    occurred_at timestamp with time zone NOT NULL,
    CONSTRAINT payment_reconciliation_findings_kind_check CHECK ((kind = ANY (ARRAY['record_unmatched'::text, 'purchase_unmatched'::text, 'amount_mismatch'::text, 'held_refund'::text, 'held_dispute'::text]))),
    CONSTRAINT payment_reconciliation_findings_purchase_check CHECK (((purchase_id IS NOT NULL) = (kind = ANY (ARRAY['purchase_unmatched'::text, 'amount_mismatch'::text])))),
    CONSTRAINT payment_reconciliation_findings_provider_payment_id_check CHECK ((char_length(provider_payment_id) >= 1)),
    CONSTRAINT payment_reconciliation_findings_purchase_currency_check CHECK ((purchase_currency ~ '^[A-Z]{3}$'::text)),
    CONSTRAINT payment_reconciliation_findings_record_currency_check CHECK ((record_currency ~ '^[A-Z]{3}$'::text))
);

-- CONSTRAINT: payment_reconciliation_findings payment_reconciliation_findings_pkey
ALTER TABLE ONLY payment_reconciliation_findings
    ADD CONSTRAINT payment_reconciliation_findings_pkey PRIMARY KEY (id);

-- FK CONSTRAINT: payment_reconciliation_findings payment_reconciliation_findings_tenant_reconciliation_id_fkey
-- A run replaced by a second one takes its findings with it.
ALTER TABLE ONLY payment_reconciliation_findings
    ADD CONSTRAINT payment_reconciliation_findings_tenant_reconciliation_id_fkey FOREIGN KEY (tenant_id, reconciliation_id) REFERENCES payment_reconciliations(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_payment_reconciliation_findings_tenant_reconciliation
-- The console's list of a run's findings in the order they happened, which
-- also serves the cascade from a deleted run.
CREATE INDEX idx_payment_reconciliation_findings_tenant_reconciliation ON payment_reconciliation_findings USING btree (tenant_id, reconciliation_id, occurred_at, id);

-- ROW SECURITY: payment_reconciliation_findings
ALTER TABLE payment_reconciliation_findings ENABLE ROW LEVEL SECURITY;

-- POLICY: payment_reconciliation_findings payment_reconciliation_findings_tenant_isolation
CREATE POLICY payment_reconciliation_findings_tenant_isolation ON payment_reconciliation_findings USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
