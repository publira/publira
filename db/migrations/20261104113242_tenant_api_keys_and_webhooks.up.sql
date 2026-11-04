-- TABLE: tenant_api_keys
-- A read-only credential a tenant hands to its own systems, sent as
-- Authorization: Bearer on the admin Connect API. The key is shown once, when
-- it is created, and only its SHA-256 is kept: it is a long random value, so a
-- slow hash would buy nothing a fast one does not.
--
-- prefix is the random part of the key that comes before its secret part, and
-- is what a request's key is looked up by and what the console shows. It is
-- unique across every tenant, so a key names one row before its tenant is
-- known.
--
-- scopes lists what the key may read: 'catalog:read', 'purchases:read'. A
-- revoked key is kept, so the console can still say which key it was, and is
-- refused from the moment revoked_at is set.
CREATE TABLE tenant_api_keys (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    name text NOT NULL,
    prefix text NOT NULL,
    key_hash bytea NOT NULL,
    scopes text[] NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    CONSTRAINT tenant_api_keys_name_check CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT tenant_api_keys_prefix_check CHECK ((prefix ~ '^[a-z2-7]{12}$'::text)),
    CONSTRAINT tenant_api_keys_key_hash_check CHECK ((octet_length(key_hash) = 32)),
    CONSTRAINT tenant_api_keys_scopes_check CHECK (((cardinality(scopes) >= 1) AND (scopes <@ ARRAY['catalog:read'::text, 'purchases:read'::text])))
);

-- CONSTRAINT: tenant_api_keys tenant_api_keys_pkey
ALTER TABLE ONLY tenant_api_keys
    ADD CONSTRAINT tenant_api_keys_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_api_keys tenant_api_keys_prefix_key
ALTER TABLE ONLY tenant_api_keys
    ADD CONSTRAINT tenant_api_keys_prefix_key UNIQUE (prefix);

-- INDEX: tenant_api_keys idx_tenant_api_keys_tenant_created_at
-- ListApiKeys, newest first.
CREATE INDEX idx_tenant_api_keys_tenant_created_at ON tenant_api_keys USING btree (tenant_id, created_at DESC, id DESC);

-- FK CONSTRAINT: tenant_api_keys tenant_api_keys_tenant_id_fkey
ALTER TABLE ONLY tenant_api_keys
    ADD CONSTRAINT tenant_api_keys_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: tenant_api_keys tenant_api_keys_tenant_created_by_user_id_fkey
-- audit_logs keeps who created the key once the account is gone.
ALTER TABLE ONLY tenant_api_keys
    ADD CONSTRAINT tenant_api_keys_tenant_created_by_user_id_fkey FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL (created_by_user_id);

-- ROW SECURITY: tenant_api_keys
ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_api_keys tenant_api_keys_tenant_isolation
CREATE POLICY tenant_api_keys_tenant_isolation ON tenant_api_keys USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: tenant_webhook_endpoints
-- A URL of the tenant's that the worker POSTs the events it subscribed to,
-- signed with HMAC-SHA256 under secret_encrypted, which is sealed with the
-- platform's secret encryption keys and shown once, when it is created or
-- rotated; secret_hint is what the console shows afterwards. A tenant keeps at
-- most five, which the server counts under a lock on the tenant.
--
-- event_types lists the events the endpoint receives. A disabled endpoint
-- receives none, and a delivery queued before it was disabled is given up.
CREATE TABLE tenant_webhook_endpoints (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    url text NOT NULL,
    secret_encrypted text NOT NULL,
    secret_hint text NOT NULL,
    event_types text[] NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_webhook_endpoints_url_check CHECK (((url ~ '^https://'::text) AND (char_length(url) <= 2048))),
    CONSTRAINT tenant_webhook_endpoints_event_types_check CHECK (((cardinality(event_types) >= 1) AND (event_types <@ ARRAY['purchase.completed'::text, 'purchase.refunded'::text, 'reader.signed_up'::text, 'subscription.started'::text, 'subscription.ended'::text])))
);

-- CONSTRAINT: tenant_webhook_endpoints tenant_webhook_endpoints_pkey
ALTER TABLE ONLY tenant_webhook_endpoints
    ADD CONSTRAINT tenant_webhook_endpoints_pkey PRIMARY KEY (id);

-- CONSTRAINT: tenant_webhook_endpoints tenant_webhook_endpoints_tenant_id_id_key
-- The target of the composite foreign key that keeps a delivery from naming
-- another tenant's endpoint.
ALTER TABLE ONLY tenant_webhook_endpoints
    ADD CONSTRAINT tenant_webhook_endpoints_tenant_id_id_key UNIQUE (tenant_id, id);

-- INDEX: tenant_webhook_endpoints idx_tenant_webhook_endpoints_tenant_created_at
-- ListWebhookEndpoints, oldest first, and the endpoints an event is owed to.
CREATE INDEX idx_tenant_webhook_endpoints_tenant_created_at ON tenant_webhook_endpoints USING btree (tenant_id, created_at, id);

-- FK CONSTRAINT: tenant_webhook_endpoints tenant_webhook_endpoints_tenant_id_fkey
ALTER TABLE ONLY tenant_webhook_endpoints
    ADD CONSTRAINT tenant_webhook_endpoints_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_webhook_endpoints
ALTER TABLE tenant_webhook_endpoints ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_webhook_endpoints tenant_webhook_endpoints_tenant_isolation
CREATE POLICY tenant_webhook_endpoints_tenant_isolation ON tenant_webhook_endpoints USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- TABLE: webhook_deliveries
-- One event owed to one endpoint, and how its delivery went. Each is sent by a
-- webhook_delivery outbox event written in the same transaction, which a
-- resend writes again for the same row.
--
-- event_id is the id the receiver sees, the same for every endpoint the event
-- goes to. It is derived from what the event is about, so a change recorded
-- twice — a provider's notification delivered again — owes each endpoint one
-- delivery, which the unique key keeps. payload is the body sent, as stored.
--
-- status is 'pending' until the first attempt, 'failed' while an attempt
-- failed and another is due, 'delivered' once the endpoint answered 2xx, and
-- 'dead' once the attempts ran out, the endpoint refused it for good, or the
-- endpoint was disabled.
CREATE TABLE webhook_deliveries (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    endpoint_id uuid NOT NULL,
    event_type text NOT NULL,
    event_id text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    attempts integer DEFAULT 0 NOT NULL,
    last_status_code integer,
    last_error text,
    delivered_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT webhook_deliveries_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'failed'::text, 'delivered'::text, 'dead'::text]))),
    CONSTRAINT webhook_deliveries_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT webhook_deliveries_payload_object_check CHECK ((jsonb_typeof(payload) = 'object'::text)),
    CONSTRAINT webhook_deliveries_delivered_check CHECK (((status = 'delivered'::text) = (delivered_at IS NOT NULL)))
);

-- CONSTRAINT: webhook_deliveries webhook_deliveries_pkey
ALTER TABLE ONLY webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_pkey PRIMARY KEY (id);

-- CONSTRAINT: webhook_deliveries webhook_deliveries_endpoint_event_key
ALTER TABLE ONLY webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_endpoint_event_key UNIQUE (endpoint_id, event_id);

-- INDEX: webhook_deliveries idx_webhook_deliveries_tenant_created_at
-- ListWebhookDeliveries, newest first.
CREATE INDEX idx_webhook_deliveries_tenant_created_at ON webhook_deliveries USING btree (tenant_id, created_at DESC, id DESC);

-- INDEX: webhook_deliveries idx_webhook_deliveries_tenant_status_created_at
-- ListWebhookDeliveries narrowed to one status, newest first.
CREATE INDEX idx_webhook_deliveries_tenant_status_created_at ON webhook_deliveries USING btree (tenant_id, status, created_at DESC, id DESC);

-- FK CONSTRAINT: webhook_deliveries webhook_deliveries_tenant_id_fkey
ALTER TABLE ONLY webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- FK CONSTRAINT: webhook_deliveries webhook_deliveries_tenant_endpoint_id_fkey
-- An endpoint deleted takes its deliveries with it; an outbox event left for
-- one finds nothing to send.
ALTER TABLE ONLY webhook_deliveries
    ADD CONSTRAINT webhook_deliveries_tenant_endpoint_id_fkey FOREIGN KEY (tenant_id, endpoint_id) REFERENCES tenant_webhook_endpoints(tenant_id, id) ON DELETE CASCADE;

-- ROW SECURITY: webhook_deliveries
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;

-- POLICY: webhook_deliveries webhook_deliveries_tenant_isolation
CREATE POLICY webhook_deliveries_tenant_isolation ON webhook_deliveries USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid)) WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- COLUMN: platform_policy_config api_key_request_limit_per_minute
-- COLUMN: platform_policy_config api_key_request_limit_per_day
-- How many requests one tenant API key may make. These keep their defaults:
-- the previous release's insert does not name them.
ALTER TABLE platform_policy_config
    ADD COLUMN api_key_request_limit_per_minute integer DEFAULT 600 NOT NULL,
    ADD COLUMN api_key_request_limit_per_day integer DEFAULT 100000 NOT NULL;

-- CONSTRAINT: platform_policy_config platform_policy_config_api_key_request_limit_check
ALTER TABLE ONLY platform_policy_config
    ADD CONSTRAINT platform_policy_config_api_key_request_limit_check CHECK (((api_key_request_limit_per_minute >= 1) AND (api_key_request_limit_per_day >= api_key_request_limit_per_minute)));
