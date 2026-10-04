CREATE OR REPLACE VIEW published_free_episodes WITH (security_invoker = true) AS
SELECT e.id AS episode_id,
    e.series_id,
    e.tenant_id,
    fw.ends_at AS free_until
FROM episodes e
    JOIN episode_listings el ON el.episode_id = e.id
    LEFT JOIN episode_free_windows fw ON fw.episode_id = e.id
    AND fw.starts_at <= NOW()
    AND fw.ends_at > NOW()
WHERE el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
    AND (
        el.price = 0
        OR fw.ends_at IS NOT NULL
    );
