-- name: ListPublishedEpisodeAccessInSeries :many
-- Every published episode of one series with the two facts its access state is
-- decided from: whether published_free_episodes counts it free to everyone
-- right now, and which grant in episode_content_grants opens it to the reader,
-- in the order GetEpisodeEntitlementSource reports one, or '' when none
-- does. owned is whether one of those grants is a permanent copy, which is the
-- grant ListSeriesRemainderEpisodes counts as held. A guest passes a NULL
-- user_id, which no grant matches. The episodes are the ones
-- published_episode_surfaces opens on the calling surface, and the order is
-- the one GetSeriesDetail lists them in.
SELECT e.id,
    e.public_id,
    EXISTS (
        SELECT 1
        FROM published_free_episodes fe
        WHERE fe.episode_id = e.id
    ) AS free_to_everyone,
    COALESCE((
        SELECT g.kind
        FROM episode_content_grants g
        WHERE g.tenant_id = e.tenant_id
            AND g.user_id = sqlc.narg('user_id')::uuid
            AND g.episode_id = e.id
        ORDER BY CASE g.kind
                WHEN 'creator' THEN 0
                WHEN 'purchase' THEN 1
                WHEN 'access_ticket' THEN 2
                WHEN 'subscription' THEN 3
                ELSE 4
            END
        LIMIT 1
    ), '')::text AS grant_kind,
    EXISTS (
        SELECT 1
        FROM episode_content_grants g
        WHERE g.tenant_id = e.tenant_id
            AND g.user_id = sqlc.narg('user_id')::uuid
            AND g.episode_id = e.id
            AND g.purchase_kind = 'purchase'
    ) AS owned
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
-- only says how a reader came to hold the episode. A subscription and then the
-- staff grant come after those two, because each opens many episodes at once:
-- a subscription would otherwise hide the episode a subscriber bought to keep,
-- and the staff grant, which holds every episode of the tenant, the purchase a
-- member of staff made to try the checkout.
-- ListPublishedEpisodeAccessInSeries reports in the same order. No row means
-- no grant.
SELECT g.kind
FROM episode_content_grants g
WHERE g.tenant_id = sqlc.arg('tenant_id')
    AND g.user_id = sqlc.arg('user_id')::uuid
    AND g.episode_id = sqlc.arg('episode_id')
ORDER BY CASE g.kind
        WHEN 'creator' THEN 0
        WHEN 'purchase' THEN 1
        WHEN 'access_ticket' THEN 2
        WHEN 'subscription' THEN 3
        ELSE 4
    END
LIMIT 1;

-- name: ReaderHoldsStaffGrantOnEpisode :one
-- Whether the reader's staff role opens the episode, whatever other grant they
-- also hold. It reads the view rather than tenant_user_roles so the roles that
-- count as staff stay written in one place.
SELECT EXISTS (
    SELECT 1
    FROM episode_content_grants g
    WHERE g.tenant_id = sqlc.arg('tenant_id')
        AND g.user_id = sqlc.arg('user_id')::uuid
        AND g.episode_id = sqlc.arg('episode_id')
        AND g.kind = 'staff'
) AS is_staff;
