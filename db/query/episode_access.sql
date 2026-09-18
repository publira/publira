-- name: ListPublishedEpisodeAccessInSeries :many
-- Every published episode of one series with the two facts its access state is
-- decided from: whether published_free_episodes counts it free to everyone
-- right now, and whether the reader holds a grant for it. The grant is the
-- predicate UserHasEpisodeContentAccess answers one episode at a time, and a
-- guest passes a NULL user_id, which no grant matches. The order is the one
-- GetSeriesDetail lists the episodes in.
SELECT e.public_id,
    EXISTS (
        SELECT 1
        FROM published_free_episodes fe
        WHERE fe.episode_id = e.id
    ) AS free_to_everyone,
    (
        EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = s.tenant_id
                AND p.user_id = sqlc.narg('user_id')::uuid
                AND p.episode_id = e.id
                AND (
                    p.expires_at IS NULL
                    OR p.expires_at > NOW()
                )
                AND p.refunded_at IS NULL
        )
        OR EXISTS (
            SELECT 1
            FROM access_tickets at
            WHERE at.tenant_id = s.tenant_id
                AND at.user_id = sqlc.narg('user_id')::uuid
                AND at.episode_id = e.id
                AND at.revoked_at IS NULL
                AND (
                    at.expires_at IS NULL
                    OR at.expires_at > NOW()
                )
        )
    )::boolean AS has_grant
FROM episodes e
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('series_id')
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
    AND EXISTS (
        SELECT 1
        FROM episode_surfaces es
        WHERE es.episode_id = e.id
            AND es.surface = sqlc.arg('surface')::text
    )
ORDER BY e.order_index ASC,
    e.id ASC;
