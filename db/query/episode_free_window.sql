-- name: CreateEpisodeFreeWindow :one
INSERT INTO episode_free_windows (
        id,
        tenant_id,
        public_id,
        episode_id,
        starts_at,
        ends_at,
        created_by_user_id
    )
VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING id,
    tenant_id,
    public_id,
    episode_id,
    starts_at,
    ends_at,
    created_by_user_id,
    created_at;

-- name: GetEpisodeFreeWindowByIDForTenant :one
SELECT w.id,
    w.public_id,
    w.starts_at,
    w.ends_at,
    w.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_free_windows w
    JOIN episodes e ON e.id = w.episode_id
    JOIN series s ON s.id = e.series_id
WHERE w.tenant_id = $1
    AND w.id = $2
LIMIT 1;

-- Admin ListEpisodeFreeWindows is (starts_at, id) DESC: the window furthest
-- ahead first, then the open one, then the ones already over, which are kept
-- until someone deletes them. Forward uses the DESC queries; backward uses ASC,
-- and the handler flips its rows back into display order.
--
-- Each scope has queries of its own rather than one with optional filters, so
-- every scan is bounded by the page and not by how much history the episodes
-- have collected. On one episode the exclusion constraint makes starts_at
-- unique, so idx_episode_free_windows_episode_period yields the whole order and
-- the scan stops after one page. A series has no column on the window to index,
-- so it takes at most one page from each of its episodes by that same index and
-- sorts only those: the work grows with the number of episodes, never with the
-- windows that are over.
-- cursor rules: proto/README.md.
-- name: ListEpisodeFreeWindowsByEpisodeForTenantDesc :many
SELECT w.id,
    w.public_id,
    w.starts_at,
    w.ends_at,
    w.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM episode_free_windows w
    JOIN episodes e ON e.id = w.episode_id
    JOIN series s ON s.id = e.series_id
WHERE w.tenant_id = sqlc.arg('tenant_id')
    AND w.episode_id = sqlc.arg('episode_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (w.starts_at, w.id) <= (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (w.starts_at, w.id) < (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY w.starts_at DESC,
    w.id DESC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeFreeWindowsByEpisodeForTenantAsc :many
SELECT w.id,
    w.public_id,
    w.starts_at,
    w.ends_at,
    w.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM episode_free_windows w
    JOIN episodes e ON e.id = w.episode_id
    JOIN series s ON s.id = e.series_id
WHERE w.tenant_id = sqlc.arg('tenant_id')
    AND w.episode_id = sqlc.arg('episode_id')
    AND (
        sqlc.narg('cursor_id')::uuid IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (w.starts_at, w.id) >= (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (w.starts_at, w.id) > (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
        )
    )
ORDER BY w.starts_at ASC,
    w.id ASC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeFreeWindowsBySeriesForTenantDesc :many
SELECT w.id,
    w.public_id,
    w.starts_at,
    w.ends_at,
    w.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM series s
    JOIN episodes e ON e.series_id = s.id
    CROSS JOIN LATERAL (
        SELECT fw.id,
            fw.public_id,
            fw.starts_at,
            fw.ends_at,
            fw.created_at
        FROM episode_free_windows fw
        WHERE fw.episode_id = e.id
            AND (
                sqlc.narg('cursor_id')::uuid IS NULL
                OR (
                    sqlc.arg('cursor_inclusive')::boolean
                    AND (fw.starts_at, fw.id) <= (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
                )
                OR (
                    NOT sqlc.arg('cursor_inclusive')::boolean
                    AND (fw.starts_at, fw.id) < (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
                )
            )
        ORDER BY fw.starts_at DESC,
            fw.id DESC
        LIMIT sqlc.arg('limit')
    ) w
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('series_id')
ORDER BY w.starts_at DESC,
    w.id DESC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeFreeWindowsBySeriesForTenantAsc :many
SELECT w.id,
    w.public_id,
    w.starts_at,
    w.ends_at,
    w.created_at,
    e.id AS episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.id AS series_id,
    s.public_id AS series_public_id
FROM series s
    JOIN episodes e ON e.series_id = s.id
    CROSS JOIN LATERAL (
        SELECT fw.id,
            fw.public_id,
            fw.starts_at,
            fw.ends_at,
            fw.created_at
        FROM episode_free_windows fw
        WHERE fw.episode_id = e.id
            AND (
                sqlc.narg('cursor_id')::uuid IS NULL
                OR (
                    sqlc.arg('cursor_inclusive')::boolean
                    AND (fw.starts_at, fw.id) >= (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
                )
                OR (
                    NOT sqlc.arg('cursor_inclusive')::boolean
                    AND (fw.starts_at, fw.id) > (sqlc.narg('cursor_starts_at')::timestamptz, sqlc.narg('cursor_id')::uuid)
                )
            )
        ORDER BY fw.starts_at ASC,
            fw.id ASC
        LIMIT sqlc.arg('limit')
    ) w
WHERE s.tenant_id = sqlc.arg('tenant_id')
    AND s.id = sqlc.arg('series_id')
ORDER BY w.starts_at ASC,
    w.id ASC
LIMIT sqlc.arg('limit');

-- name: DeleteEpisodeFreeWindowByIDForTenant :one
-- Returns the deleted row so a concurrent second delete is told apart from a
-- window that never existed. What the caller audits and revalidates comes
-- from the read it did first.
DELETE FROM episode_free_windows
WHERE tenant_id = $1
    AND id = $2
RETURNING id,
    public_id,
    episode_id,
    starts_at,
    ends_at;

-- name: ListEpisodeFreeWindowBoundariesDue :many
-- Every window with a boundary the apply-free-windows batch has not dropped
-- the site caches for yet. A window whose start and end both passed while the
-- batch was down comes back with both flags set, and one revalidation answers
-- for both.
--
-- This spans every tenant, so the connection must bypass RLS.
SELECT w.id,
    w.tenant_id,
    w.starts_at,
    w.ends_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    (
        w.start_revalidated_at IS NULL
        AND w.starts_at <= NOW()
    ) AS start_due,
    (
        w.end_revalidated_at IS NULL
        AND w.ends_at <= NOW()
    ) AS end_due
FROM episode_free_windows w
    JOIN episodes e ON e.id = w.episode_id
    JOIN series s ON s.id = e.series_id
WHERE (
        w.start_revalidated_at IS NULL
        AND w.starts_at <= NOW()
    )
    OR (
        w.end_revalidated_at IS NULL
        AND w.ends_at <= NOW()
    )
ORDER BY w.starts_at ASC,
    w.id ASC;

-- name: MarkEpisodeFreeWindowStartRevalidated :exec
UPDATE episode_free_windows
SET start_revalidated_at = NOW()
WHERE id = $1
    AND start_revalidated_at IS NULL;

-- name: MarkEpisodeFreeWindowEndRevalidated :exec
UPDATE episode_free_windows
SET end_revalidated_at = NOW()
WHERE id = $1
    AND end_revalidated_at IS NULL;
