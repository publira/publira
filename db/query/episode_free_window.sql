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

-- name: GetEpisodeFreeWindowByPublicIDForTenant :one
SELECT w.id,
    w.public_id,
    w.starts_at,
    w.ends_at,
    w.created_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_free_windows w
    JOIN episodes e ON e.id = w.episode_id
    JOIN series s ON s.id = e.series_id
WHERE w.tenant_id = $1
    AND w.public_id = $2
LIMIT 1;

-- name: DeleteEpisodeFreeWindowByPublicIDForTenant :one
-- Returns the deleted row so a concurrent second delete is told apart from a
-- public_id that never existed. What the caller audits and revalidates comes
-- from the read it did first.
DELETE FROM episode_free_windows
WHERE tenant_id = $1
    AND public_id = $2
RETURNING id,
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
