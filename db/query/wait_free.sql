-- name: GetSeriesWaitFreeSettings :one
-- One series' wait-for-free rule. No row means the rule was never configured,
-- which the caller answers with the column defaults: off.
SELECT series_id,
    enabled,
    recharge_hours,
    access_hours,
    excluded_latest_count
FROM series_wait_free_settings
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id');

-- name: UpsertSeriesWaitFreeSettings :one
INSERT INTO series_wait_free_settings (
        tenant_id,
        series_id,
        enabled,
        recharge_hours,
        access_hours,
        excluded_latest_count
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('series_id'),
        sqlc.arg('enabled'),
        sqlc.arg('recharge_hours'),
        sqlc.arg('access_hours'),
        sqlc.arg('excluded_latest_count')
    ) ON CONFLICT (series_id) DO
UPDATE
SET enabled = EXCLUDED.enabled,
    recharge_hours = EXCLUDED.recharge_hours,
    access_hours = EXCLUDED.access_hours,
    excluded_latest_count = EXCLUDED.excluded_latest_count
RETURNING series_id,
    enabled,
    recharge_hours,
    access_hours,
    excluded_latest_count;

-- name: GetWaitFreeEpisode :one
-- A published episode of a published series, both shown on the calling
-- surface, with what UseTicket decides from. free_to_everyone reads
-- published_free_episodes, so an episode a free window has opened needs no
-- ticket.
--
-- later_episode_count is how many published episodes on the surface follow
-- this one in the order GetSeriesDetail lists them, (order_index, id). An
-- episode with fewer than the series' excluded_latest_count after it is one of
-- the latest the rule keeps a ticket off, and GetSeriesDetail marks the same
-- episodes by taking that many off the end of its own list.
SELECT e.id,
    e.series_id,
    sl.age_rating,
    EXISTS (
        SELECT 1
        FROM published_free_episodes fe
        WHERE fe.episode_id = e.id
    ) AS free_to_everyone,
    (
        SELECT COUNT(*)
        FROM episodes later
        WHERE later.series_id = e.series_id
            AND (later.order_index, later.id) > (e.order_index, e.id)
            AND EXISTS (
                SELECT 1
                FROM published_episode_surfaces lpes
                WHERE lpes.episode_id = later.id
                    AND lpes.surface = sqlc.arg('surface')::text
            )
    )::int4 AS later_episode_count
FROM episodes e
    JOIN series s ON s.id = e.series_id
    LEFT JOIN series_listings sl ON sl.series_id = s.id
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND e.id = sqlc.arg('id')
    AND EXISTS (
        SELECT 1
        FROM published_episode_surfaces pes
        WHERE pes.episode_id = e.id
            AND pes.surface = sqlc.arg('surface')::text
    )
LIMIT 1;

-- name: GetWaitFreeTicketState :one
-- When the reader's next ticket on the series is ready, and whether that is
-- still ahead. charging is decided by the database's clock, the one the
-- claim below and the grants view compare against. No row means the reader
-- has never used a ticket here, and one is ready.
SELECT next_available_at,
    next_available_at > NOW() AS charging
FROM wait_free_ticket_states
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND series_id = sqlc.arg('series_id');

-- name: ClaimWaitFreeTicket :one
-- Spends the reader's ticket on the series and starts the next recharge, when
-- one is ready. No row means none was: the update's condition failed on a row
-- whose instant is still ahead.
--
-- The upsert takes the row lock, so a second claim at the same moment waits
-- for the first to commit and then finds the instant it set, ahead of NOW().
-- Two first claims meet on the primary key the same way.
INSERT INTO wait_free_ticket_states (
        tenant_id,
        user_id,
        series_id,
        next_available_at
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('user_id'),
        sqlc.arg('series_id'),
        NOW() + sqlc.arg('recharge_hours')::int4 * INTERVAL '1 hour'
    ) ON CONFLICT (tenant_id, user_id, series_id) DO
UPDATE
SET next_available_at = EXCLUDED.next_available_at
WHERE wait_free_ticket_states.next_available_at <= NOW()
RETURNING next_available_at;

-- name: CreateWaitFreeAccessTicket :one
-- The grant a spent ticket opens. It is an access_tickets row so every read
-- that decides access sees it through episode_content_grants, and it expires
-- by the series' access period from the same clock.
INSERT INTO access_tickets (
        id,
        tenant_id,
        public_id,
        episode_id,
        user_id,
        expires_at,
        source
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('public_id'),
        sqlc.arg('episode_id'),
        sqlc.arg('user_id'),
        NOW() + sqlc.arg('access_hours')::int4 * INTERVAL '1 hour',
        'wait_free'
    )
RETURNING id,
    episode_id,
    expires_at;

-- name: ListOpenWaitFreeTicketsInSeries :many
-- The reader's wait-for-free tickets on the series that still open their
-- episode, soonest to close first. A ticket on an episode that has since been
-- taken down, or that the calling surface does not show, is left out: the
-- reader could not open it there, so it is not one to show them.
SELECT at.episode_id,
    at.expires_at
FROM access_tickets at
    JOIN episodes e ON e.id = at.episode_id
WHERE at.tenant_id = sqlc.arg('tenant_id')
    AND at.user_id = sqlc.arg('user_id')
    AND e.series_id = sqlc.arg('series_id')
    AND at.source = 'wait_free'
    AND at.revoked_at IS NULL
    AND at.expires_at > NOW()
    AND EXISTS (
        SELECT 1
        FROM published_episode_surfaces pes
        WHERE pes.episode_id = e.id
            AND pes.surface = sqlc.arg('surface')::text
    )
ORDER BY at.expires_at ASC,
    at.id ASC;
