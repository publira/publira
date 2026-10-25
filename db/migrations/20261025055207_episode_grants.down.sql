-- The function names the view only inside its body, which PostgreSQL does not
-- record as a dependency, so it is put back on episode_content_grants first.
CREATE OR REPLACE FUNCTION reader_may_open_episode(tenant_id uuid, user_id uuid, episode_id uuid) RETURNS boolean
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

DROP VIEW episode_grants;
