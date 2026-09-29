-- The tenant's own mean reaction rate, kept as the two totals it is made of.
--
-- A series with few completed reads is rated mostly by this number, so every
-- series page needs it. Taken live it is a sum over every series row the tenant
-- has in content_daily_stats, which is one row per series per day and is never
-- purged — the reads of a page that grows without bound as the tenant keeps
-- publishing. The value changes once a day at most, which is how often
-- aggregate-content-stats rebuilds the rows behind it, so the page reads what
-- that batch left rather than recomputing it per request.

-- TABLE: tenant_rating_totals
-- One row per tenant that has had a day rebuilt. The totals are stored rather
-- than the mean they form, because a rate is only meaningful beside the reads
-- it was taken over: a tenant with no completed reads at all has no mean, and
-- two zeros say so where a stored 0 would read as a tenant everybody dislikes.
CREATE TABLE tenant_rating_totals (
    tenant_id uuid NOT NULL,
    points bigint DEFAULT 0 NOT NULL,
    completed_reads bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_rating_totals_nonneg_check CHECK (((points >= 0) AND (completed_reads >= 0)))
);

-- CONSTRAINT: tenant_rating_totals tenant_rating_totals_pkey
ALTER TABLE ONLY tenant_rating_totals
    ADD CONSTRAINT tenant_rating_totals_pkey PRIMARY KEY (tenant_id);

-- FK CONSTRAINT: tenant_rating_totals tenant_rating_totals_tenant_id_fkey
ALTER TABLE ONLY tenant_rating_totals
    ADD CONSTRAINT tenant_rating_totals_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ROW SECURITY: tenant_rating_totals
ALTER TABLE tenant_rating_totals ENABLE ROW LEVEL SECURITY;

-- POLICY: tenant_rating_totals tenant_rating_totals_tenant_isolation
CREATE POLICY tenant_rating_totals_tenant_isolation ON tenant_rating_totals
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- The totals are derived, so they open holding what the daily stats already
-- say rather than zero, and a tenant whose next aggregate run has not happened
-- yet still rates its series against a mean of its own.
INSERT INTO tenant_rating_totals (tenant_id, points, completed_reads)
SELECT cds.tenant_id, sum(cds.rating_sum), sum(cds.complete_count)
FROM content_daily_stats cds
WHERE cds.entity_type = 'series'
GROUP BY cds.tenant_id;
