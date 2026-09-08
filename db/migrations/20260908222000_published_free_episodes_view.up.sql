-- VIEW: published_free_episodes
-- The episodes a reader can open without paying, as one definition: a
-- published episode priced at 0, or a priced one a free window covers at the
-- moment of the read. The catalog asks the same question in two shapes — does
-- this series have such an episode, and how many does it have — from six
-- queries, and each of them spelling the rule out again is how a filter and a
-- count come to disagree about the same series.
--
-- security_invoker keeps the row-level security of episodes, episode_listings,
-- and episode_free_windows the caller's own. Without it the view would run
-- with its owner's rights, and its owner is the role that applies migrations,
-- which bypasses RLS: every tenant-scoped query reading through the view would
-- see every tenant's episodes.
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
