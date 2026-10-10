-- name: ListPublishedEpisodeAccessInSeries :many
-- Every published episode of one series with the two facts its access state is
-- decided from: whether published_free_episodes counts it free to everyone
-- right now, and whether episode_content_grants holds a grant for the reader.
-- A guest passes a NULL user_id, which no grant matches. The episodes are the
-- ones published_episode_surfaces opens on the calling surface, and the order
-- is the one GetSeriesDetail lists them in.
SELECT e.id,
    e.public_id,
    EXISTS (
        SELECT 1
        FROM published_free_episodes fe
        WHERE fe.episode_id = e.id
    ) AS free_to_everyone,
    EXISTS (
        SELECT 1
        FROM episode_content_grants g
        WHERE g.tenant_id = e.tenant_id
            AND g.user_id = sqlc.narg('user_id')::uuid
            AND g.episode_id = e.id
    ) AS has_grant
FROM episodes e
    JOIN published_episode_surfaces pes ON pes.episode_id = e.id
WHERE e.tenant_id = sqlc.arg('tenant_id')
    AND e.series_id = sqlc.arg('series_id')
    AND pes.surface = sqlc.arg('surface')::text
ORDER BY e.order_index ASC,
    e.id ASC;

-- name: GetEpisodeEntitlementSource :one
-- Which grant opens the episode to the reader, when one does. A reader can
-- hold several, and the creator grant is reported first because it is the
-- standing one: it is what the credit line says, where a purchase or a ticket
-- only says how a reader came to hold the episode. No row means no grant.
SELECT g.kind
FROM episode_content_grants g
WHERE g.tenant_id = sqlc.arg('tenant_id')
    AND g.user_id = sqlc.arg('user_id')::uuid
    AND g.episode_id = sqlc.arg('episode_id')
ORDER BY CASE g.kind
        WHEN 'creator' THEN 0
        WHEN 'purchase' THEN 1
        ELSE 2
    END
LIMIT 1;
