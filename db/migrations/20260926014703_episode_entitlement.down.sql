DROP FUNCTION reader_may_open_episode(uuid, uuid, uuid);

-- CREATE OR REPLACE cannot drop a column, so the view is recreated as it was.
DROP VIEW published_free_episodes;

CREATE VIEW published_free_episodes WITH (security_invoker = true) AS
SELECT e.id AS episode_id,
    e.series_id,
    e.tenant_id
FROM episodes e
    JOIN episode_listings el ON el.episode_id = e.id
WHERE el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
    AND (
        el.price = 0
        OR EXISTS (
            SELECT 1
            FROM episode_free_windows fw
            WHERE fw.episode_id = e.id
                AND fw.starts_at <= NOW()
                AND fw.ends_at > NOW()
        )
    );
