-- Which days each reader was active on, kept after the content events of those
-- days are purged, so the console can follow a week's sign-ups for weeks.
--
-- content_events is kept for the tenant's retention period and no longer,
-- while users.created_at is kept for good. aggregate-content-stats files each
-- tenant day of the events into this table as one row per member and series
-- they viewed, finished, or bought an episode of that day, beside
-- content_daily_stats, and nothing purges it.

-- TABLE: reader_daily_activity
-- One row per tenant day, member, and series the member viewed, finished, or
-- bought an episode of during that day. It carries nothing else about the
-- events: a report counts distinct members over its days, so a member active
-- on several days, or in several series on one day, is one reader of them.
CREATE TABLE reader_daily_activity (
    tenant_id uuid NOT NULL,
    stat_date date NOT NULL,
    user_id uuid NOT NULL,
    series_id uuid NOT NULL
);

-- CONSTRAINT: reader_daily_activity reader_daily_activity_pkey
-- Led by the member, because every report starts from a set of members, those
-- who signed up in a period, and reads their days.
ALTER TABLE ONLY reader_daily_activity
    ADD CONSTRAINT reader_daily_activity_pkey PRIMARY KEY (tenant_id, user_id, stat_date, series_id);

-- FK CONSTRAINT: reader_daily_activity reader_daily_activity_tenant_user_id_fkey
-- A deleted account takes its days with it, so it leaves the cohort it signed
-- up in and every figure counted over that cohort at once.
ALTER TABLE ONLY reader_daily_activity
    ADD CONSTRAINT reader_daily_activity_tenant_user_id_fkey FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE;

-- FK CONSTRAINT: reader_daily_activity reader_daily_activity_tenant_series_id_fkey
-- Composite FK prevents referencing a series that belongs to another tenant.
ALTER TABLE ONLY reader_daily_activity
    ADD CONSTRAINT reader_daily_activity_tenant_series_id_fkey FOREIGN KEY (tenant_id, series_id) REFERENCES series(tenant_id, id) ON DELETE CASCADE;

-- INDEX: idx_reader_daily_activity_tenant_date
-- The rows a rebuild of one tenant day replaces.
CREATE INDEX idx_reader_daily_activity_tenant_date ON reader_daily_activity USING btree (tenant_id, stat_date);

-- ROW SECURITY: reader_daily_activity
ALTER TABLE reader_daily_activity ENABLE ROW LEVEL SECURITY;

-- POLICY: reader_daily_activity reader_daily_activity_tenant_isolation
CREATE POLICY reader_daily_activity_tenant_isolation ON reader_daily_activity
    USING ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid))
    WITH CHECK ((tenant_id = (NULLIF(current_setting('app.current_tenant_id'::text, true), ''::text))::uuid));

-- The days already rebuilt before this table existed are filed here from the
-- content events the purge has left, the way aggregate-content-stats files a
-- day, since the worker does not go back over a day it has finished. A day that
-- began before the tenant's purge reached is left out, as the rebuild leaves it
-- out: some of its events are gone. A day the worker has yet to rebuild is
-- filed here too, and replaced when it is rebuilt.
INSERT INTO reader_daily_activity (tenant_id, stat_date, user_id, series_id)
SELECT DISTINCT
    ce.tenant_id,
    (ce.occurred_at AT TIME ZONE btrim(t.timezone))::date,
    ce.user_id,
    ce.series_id
FROM content_events ce
JOIN tenants t ON t.id = ce.tenant_id
LEFT JOIN content_event_purges cep ON cep.tenant_id = ce.tenant_id
WHERE ce.event_type IN ('episode_view', 'episode_complete', 'purchase')
    AND ce.user_id IS NOT NULL
    AND (
        cep.purged_before IS NULL
        OR ((ce.occurred_at AT TIME ZONE btrim(t.timezone))::date::timestamp AT TIME ZONE btrim(t.timezone)) >= cep.purged_before
    );
