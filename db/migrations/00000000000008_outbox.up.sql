-- Outbox: Transactional outbox for business side effects.

-- TABLE: outbox_events
-- Business-side-effect outbox (#287). Domain writes insert a pending row in
-- the same transaction. A BYPASSRLS worker claims across tenants; audit
-- events stay out (#190). tenant_id is nullable so platform-level events
-- can live here; tenant events must also carry tenant_id in payload.
CREATE TABLE outbox_events (
    id uuid NOT NULL,
    tenant_id uuid,
    event_type character varying(64) NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    idempotency_key text NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    available_at timestamp with time zone DEFAULT now() NOT NULL,
    last_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outbox_events_attempts_nonneg_check CHECK ((attempts >= 0)),
    CONSTRAINT outbox_events_event_type_check CHECK ((char_length((event_type)::text) > 0)),
    CONSTRAINT outbox_events_idempotency_key_check CHECK ((char_length(idempotency_key) > 0)),
    CONSTRAINT outbox_events_payload_object_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT outbox_events_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'processing'::character varying, 'done'::character varying, 'dead'::character varying])::text[]))),
    CONSTRAINT outbox_events_tenant_payload_check CHECK (((tenant_id IS NULL) OR ((payload ->> 'tenant_id'::text) IS NOT DISTINCT FROM (tenant_id)::text)))
);

-- CONSTRAINT: outbox_events outbox_events_pkey
ALTER TABLE ONLY outbox_events
    ADD CONSTRAINT outbox_events_pkey PRIMARY KEY (id);

-- CONSTRAINT: outbox_events outbox_events_idempotency_key_key
-- Duplicate side-effect inserts (retries of the same API TX) collapse to one row.
ALTER TABLE ONLY outbox_events
    ADD CONSTRAINT outbox_events_idempotency_key_key UNIQUE (idempotency_key);

-- FK CONSTRAINT: outbox_events outbox_events_tenant_id_fkey
ALTER TABLE ONLY outbox_events
    ADD CONSTRAINT outbox_events_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- INDEX: idx_outbox_events_pending_available_at
-- Worker drain: pending rows whose available_at has arrived, claimed with
-- FOR UPDATE SKIP LOCKED in available_at / id order.
CREATE INDEX idx_outbox_events_pending_available_at ON outbox_events USING btree (available_at, id) WHERE ((status)::text = 'pending'::text);

-- INDEX: idx_outbox_events_tenant_id
CREATE INDEX idx_outbox_events_tenant_id ON outbox_events USING btree (tenant_id) WHERE (tenant_id IS NOT NULL);

-- ROW SECURITY: outbox_events
-- Tenant-scoped API roles see only their tenant's rows. NULL tenant_id
-- (platform-level events) is invisible to them; the worker uses a
-- BYPASSRLS role and reads every claimable row.
ALTER TABLE outbox_events ENABLE ROW LEVEL SECURITY;

-- POLICY: outbox_events outbox_events_tenant_isolation
CREATE POLICY outbox_events_tenant_isolation ON outbox_events USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));
