-- name: GetSeriesFreeAfterSettings :one
-- One series' free-after-publication rule. No row means the rule was never
-- configured, which the caller answers with the column defaults: off.
SELECT series_id,
    enabled,
    days_after_publication,
    excluded_latest_count
FROM series_free_after_settings
WHERE tenant_id = sqlc.arg('tenant_id')
    AND series_id = sqlc.arg('series_id');

-- name: UpsertSeriesFreeAfterSettings :one
INSERT INTO series_free_after_settings (
        tenant_id,
        series_id,
        enabled,
        days_after_publication,
        excluded_latest_count
    )
VALUES (
        sqlc.arg('tenant_id'),
        sqlc.arg('series_id'),
        sqlc.arg('enabled'),
        sqlc.arg('days_after_publication'),
        sqlc.arg('excluded_latest_count')
    ) ON CONFLICT (series_id) DO
UPDATE
SET enabled = EXCLUDED.enabled,
    days_after_publication = EXCLUDED.days_after_publication,
    excluded_latest_count = EXCLUDED.excluded_latest_count,
    updated_at = NOW()
RETURNING series_id,
    enabled,
    days_after_publication,
    excluded_latest_count;

-- name: ListEnabledSeriesFreeAfterSettings :many
-- Every rule that is on, for the worker's pass. The pass reads each one again
-- under the series lock before it writes, so a rule turned off after this
-- listing writes nothing.
--
-- This spans every tenant, so the connection must bypass RLS.
SELECT tenant_id,
    series_id
FROM series_free_after_settings
WHERE enabled
ORDER BY tenant_id,
    series_id;

-- name: LockSeriesForFreeAfterRule :one
-- Holds the series row while the worker writes the rule's windows. Saving the
-- rule takes the same row FOR UPDATE, and so do the writes that add or reorder
-- the series' episodes, so the windows a pass writes follow the rule and the
-- episode order as they stand when it commits. The rule is read again in a
-- statement of its own afterwards: READ COMMITTED freezes a statement's
-- snapshot at its start, so a read that waited for the lock in this statement
-- would still see the rule as it was before the wait.
SELECT id
FROM series
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
FOR SHARE;

-- name: ListSeriesFreeAfterEpisodes :many
-- The episodes of one series the rule covers now: published and priced, past
-- days_after_publication since they were published, and not among the
-- excluded_latest_count latest published episodes, counted from the end of
-- the series' order as Free if you wait counts them. rule_window_id is the
-- window the rule already wrote on the episode, if it has.
--
-- starts_at is where the rule's window on the episode starts: the day the
-- rule reaches, or, when a window scheduled by hand is open then or starts
-- later, the end of the last such window, since two windows of one episode
-- cannot overlap. An episode a window scheduled by hand keeps free to the far
-- end is left out: the rule has nothing left to open.
WITH published AS (
    SELECT e.id,
        el.price,
        el.published_at + sqlc.arg('days_after_publication')::int4 * INTERVAL '1 day' AS due_at,
        ROW_NUMBER() OVER (
            ORDER BY e.order_index DESC,
                e.id DESC
        ) AS from_end
    FROM episodes e
        JOIN episode_listings el ON el.episode_id = e.id
    WHERE e.tenant_id = sqlc.arg('tenant_id')
        AND e.series_id = sqlc.arg('series_id')
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
)
SELECT p.id AS episode_id,
    rw.id AS rule_window_id,
    GREATEST(p.due_at, mw.ends_at)::timestamptz AS starts_at
FROM published p
    CROSS JOIN LATERAL (
        SELECT MAX(fw.ends_at) AS ends_at
        FROM episode_free_windows fw
        WHERE fw.episode_id = p.id
            AND fw.rule_series_id IS NULL
            AND fw.ends_at > p.due_at
    ) mw
    LEFT JOIN episode_free_windows rw ON rw.episode_id = p.id
    AND rw.rule_series_id IS NOT NULL
WHERE p.from_end > sqlc.arg('excluded_latest_count')::int4
    AND p.price > 0
    AND p.due_at <= NOW()
    AND (
        mw.ends_at IS NULL
        OR mw.ends_at < '9999-12-31 00:00:00+00'::timestamptz
    )
ORDER BY p.from_end DESC;

-- name: CreateSeriesFreeAfterWindow :one
-- A window the rule opens on one episode. It runs to the far end, which the
-- table's check holds every rule's window to: it ends when the rule stops
-- covering the episode and the window is deleted.
INSERT INTO episode_free_windows (
        id,
        tenant_id,
        public_id,
        episode_id,
        starts_at,
        ends_at,
        rule_series_id
    )
VALUES (
        sqlc.arg('id'),
        sqlc.arg('tenant_id'),
        sqlc.arg('public_id'),
        sqlc.arg('episode_id'),
        sqlc.arg('starts_at'),
        '9999-12-31 00:00:00+00'::timestamptz,
        sqlc.arg('series_id')::uuid
    )
RETURNING id,
    starts_at;

-- name: DeleteSeriesFreeAfterWindowsExcept :many
-- Removes the windows the series' rule wrote on every episode but the ones it
-- still covers, which is all of them when the rule is turned off. A window
-- scheduled by hand is never one of them.
DELETE FROM episode_free_windows w
WHERE w.tenant_id = sqlc.arg('tenant_id')
    AND w.rule_series_id = sqlc.arg('series_id')::uuid
    AND NOT (w.episode_id = ANY(sqlc.arg('kept_episode_ids')::uuid []))
RETURNING w.id,
    w.starts_at;
