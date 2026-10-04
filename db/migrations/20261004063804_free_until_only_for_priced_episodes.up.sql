-- VIEW: published_free_episodes
-- free_until is the end of the free window covering this instant, and NULL
-- when none does or when the episode costs nothing anyway: an episode whose
-- price is 0 is not free until anything, so a window on it ends nothing a
-- reader or a cache has to count down to. The window is joined only for a
-- priced episode for that reason, and the exclusion constraint on
-- episode_free_windows keeps it to one row. A query that needs the end, to
-- show a countdown or to bound how long a response may be cached, reads it
-- here instead of joining the windows again.
CREATE OR REPLACE VIEW published_free_episodes WITH (security_invoker = true) AS
SELECT e.id AS episode_id,
    e.series_id,
    e.tenant_id,
    fw.ends_at AS free_until
FROM episodes e
    JOIN episode_listings el ON el.episode_id = e.id
    LEFT JOIN episode_free_windows fw ON fw.episode_id = e.id
    AND el.price > 0
    AND fw.starts_at <= NOW()
    AND fw.ends_at > NOW()
WHERE el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
    AND (
        el.price = 0
        OR fw.ends_at IS NOT NULL
    );
