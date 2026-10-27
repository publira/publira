-- INDEX: idx_episode_listings_tenant_publication
-- The tenant's scheduled and published episodes in the order of the instant
-- they are, or were, published: scheduled_at for one still scheduled and
-- published_at for one already out. The console's publishing schedule reads a
-- page of a period from it, so a page costs its rows rather than the tenant's
-- whole history. The queries spell the CASE exactly as it is written here,
-- which is what lets the planner match it.
--
-- CONCURRENTLY, so building it does not block the editors scheduling and the
-- worker publishing episodes, which is also why this statement is the whole
-- file.
CREATE INDEX CONCURRENTLY idx_episode_listings_tenant_publication ON episode_listings USING btree (
    tenant_id,
    (CASE WHEN status = 'published' THEN published_at ELSE scheduled_at END),
    episode_id
)
    WHERE (status IN ('scheduled', 'published'));
