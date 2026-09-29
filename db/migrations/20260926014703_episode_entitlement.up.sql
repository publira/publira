-- VIEW: published_free_episodes
-- free_until is the end of the free window covering this instant, or NULL when
-- none does; the exclusion constraint on episode_free_windows keeps that to one
-- row. A query that needs the end, to show a countdown or to bound how long a
-- response may be cached, reads it here instead of joining the windows again.
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

-- FUNCTION: reader_may_open_episode
-- Whether one reader may open an episode's body right now: it is free to
-- everyone, or the reader holds a grant on it. The queries that gate on the
-- body ask this inside a statement that also writes or joins, and sqlc cannot
-- share a predicate between queries, so the rule is written here once.
--
-- The free half comes from published_free_episodes and so also requires the
-- episode's listing to be published; the series and the calling surface stay
-- the caller's to check. A guest's NULL user_id matches no grant and still
-- gets the free half's answer.
--
-- SECURITY INVOKER keeps the row-level security behind both views the
-- caller's own, as security_invoker does for the views themselves.
CREATE FUNCTION reader_may_open_episode(tenant_id uuid, user_id uuid, episode_id uuid) RETURNS boolean
    LANGUAGE sql
    STABLE
    PARALLEL SAFE
    SECURITY INVOKER
AS $$
    SELECT EXISTS (
            SELECT 1
            FROM published_free_episodes fe
            WHERE fe.episode_id = reader_may_open_episode.episode_id
        )
        OR EXISTS (
            SELECT 1
            FROM episode_content_grants g
            WHERE g.tenant_id = reader_may_open_episode.tenant_id
                AND g.user_id = reader_may_open_episode.user_id
                AND g.episode_id = reader_may_open_episode.episode_id
        )
$$;
