-- How far the content event purge has reached for each tenant. purged_before
-- is the latest cutoff a purge has applied: a tenant's events before it may be
-- gone, whatever its retention period says now. A period lengthened after a
-- purge moves the cutoff back, and the events between the two cutoffs do not
-- come back with it, so a rebuild of their days must read this rather than the
-- period alone.
CREATE TABLE content_event_purges (
    tenant_id uuid NOT NULL,
    purged_before timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_event_purges_pkey PRIMARY KEY (tenant_id),
    CONSTRAINT content_event_purges_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

ALTER TABLE content_event_purges ENABLE ROW LEVEL SECURITY;
CREATE POLICY content_event_purges_tenant_isolation ON content_event_purges
    USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
    WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
