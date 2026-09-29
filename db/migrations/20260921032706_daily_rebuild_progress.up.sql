-- How far the worker's daily rebuild chain has got for each tenant, so a day
-- the worker missed while it was down is rebuilt on its return rather than
-- skipped. Every date is the tenant's own calendar day, the one
-- content_daily_stats.stat_date means.
--
-- episode_reads_projected_at is when the last episode read projection that
-- succeeded began: a day may be aggregated only once it ended before that
-- instant, or a read finished on it would be filed after its stats were built.
-- Each *_through column is the last day that link of the chain has rebuilt,
-- and a link never passes the one before it.
CREATE TABLE daily_rebuild_progress (
    tenant_id uuid NOT NULL,
    episode_reads_projected_at timestamp with time zone NOT NULL,
    content_stats_through date NOT NULL,
    rankings_through date NOT NULL,
    recommend_features_through date NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT daily_rebuild_progress_pkey PRIMARY KEY (tenant_id),
    CONSTRAINT daily_rebuild_progress_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
    CONSTRAINT daily_rebuild_progress_order_check CHECK (rankings_through <= content_stats_through AND recommend_features_through <= rankings_through)
);

ALTER TABLE daily_rebuild_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY daily_rebuild_progress_tenant_isolation ON daily_rebuild_progress
    USING (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid)
    WITH CHECK (tenant_id = (NULLIF(current_setting('app.current_tenant_id', true), ''))::uuid);
