-- VIEW: published_episode_surfaces
-- One row per episode and surface on which a reader can open it now: its
-- series is public, its listing is published, and the episode is shown on that
-- surface. A read that answers one surface keeps the rows for it; a read that
-- asks whether a reader can open the episode anywhere asks for any row.
--
-- The rule is the one the storefront applies to an episode, held here so that
-- a query does not spell it out again and drift from the others.
--
-- security_invoker keeps the row-level security of the underlying tables the
-- caller's own; without it the view would run with the rights of the role that
-- applies migrations, which bypasses RLS.
CREATE VIEW published_episode_surfaces WITH (security_invoker = true) AS
SELECT es.episode_id,
    es.series_id,
    es.tenant_id,
    es.surface
FROM episode_surfaces es
    JOIN series s ON s.tenant_id = es.tenant_id
        AND s.id = es.series_id
    JOIN episode_listings el ON el.tenant_id = es.tenant_id
        AND el.episode_id = es.episode_id
WHERE s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW();
