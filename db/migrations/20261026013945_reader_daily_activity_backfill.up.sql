-- The readers' active days of the days rebuilt before reader_daily_activity
-- existed, filed from the content events the purge has left, the way
-- aggregate-content-stats files a day, since the worker does not go back over a
-- day it has finished. A day that began before the tenant's purge reached is
-- left out, as the rebuild leaves it out: some of its events are gone. A day the
-- worker has yet to rebuild is filed here too, and replaced when it is rebuilt.
--
-- It is a migration of its own because it reads every kept event. Adding the
-- table's foreign keys locks users and series against writes until the
-- transaction that adds them ends, and in the same file that would be the end
-- of this read. Here the rows it writes hold only the accounts they name, which
-- cannot be deleted until it commits.
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
