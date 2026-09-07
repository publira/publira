-- name: SaveEpisodeReadingPosition :one
-- Stores where the reader stopped, after checking publication and body access
-- in the same statement, so a viewer that saves on its way out cannot write a
-- position for an episode that was unpublished or a rental that has expired.
--
-- The page count comes from the episode's own images rather than from the
-- client: it is what the reader is allowed to be inside, and the caller has no
-- standing to widen it.
--
-- readable answers "may this reader open this episode, and how long is it",
-- which is the whole not-found decision; saved is empty when the page is
-- outside the episode, so the caller can tell a rejected page from an episode
-- it may not see. episode_page_count is what that caller reports back.
--
-- Saving the position the row already holds keeps updated_at: a viewer that
-- writes the current page on a timer would otherwise reorder the reader's
-- recent activity without the reader having moved.
WITH readable AS (
    SELECT e.id,
        (
            SELECT COUNT(*)
            FROM episode_images ei
            WHERE ei.episode_id = e.id
        )::integer AS page_count
    FROM episodes e
        JOIN series s ON s.id = e.series_id
        JOIN episode_listings el ON el.episode_id = e.id
    WHERE s.tenant_id = sqlc.arg('tenant_id')
        AND e.public_id = sqlc.arg('episode_public_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
        AND (
            el.price = 0
            OR EXISTS (
                SELECT 1
                FROM purchases p
                WHERE p.tenant_id = sqlc.arg('tenant_id')
                    -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                    AND p.user_id = sqlc.arg('user_id')::uuid
                    AND p.episode_id = e.id
                    AND (p.expires_at IS NULL OR p.expires_at > NOW())
            )
            OR EXISTS (
                SELECT 1
                FROM access_tickets at
                WHERE at.tenant_id = sqlc.arg('tenant_id')
                    AND at.user_id = sqlc.arg('user_id')
                    AND at.episode_id = e.id
                    AND at.revoked_at IS NULL
                    AND (at.expires_at IS NULL OR at.expires_at > NOW())
            )
        )
    LIMIT 1
),
saved AS (
    INSERT INTO episode_reading_positions (tenant_id, user_id, episode_id, page_index, page_count)
    SELECT sqlc.arg('tenant_id'), sqlc.arg('user_id'), r.id, sqlc.arg('page_index')::integer, r.page_count
    FROM readable r
    WHERE sqlc.arg('page_index')::integer >= 0
        AND sqlc.arg('page_index')::integer < r.page_count
    ON CONFLICT (tenant_id, user_id, episode_id) DO UPDATE
    SET page_index = EXCLUDED.page_index,
        page_count = EXCLUDED.page_count,
        updated_at = CASE
            WHEN episode_reading_positions.page_index = EXCLUDED.page_index
                AND episode_reading_positions.page_count = EXCLUDED.page_count
            THEN episode_reading_positions.updated_at
            ELSE NOW()
        END
    RETURNING page_index, page_count, updated_at
)
SELECT r.page_count AS episode_page_count,
    s.page_index,
    s.page_count,
    s.updated_at
FROM readable r
    LEFT JOIN saved s ON true;

-- name: GetMyEpisodeReadingPosition :one
-- The reader's position in one episode, gated on the same publication and body
-- access the save is: an episode they may no longer open has no position to
-- resume, and answering with one would tell them the row is still there.
SELECT rp.page_index,
    rp.page_count,
    rp.updated_at
FROM episode_reading_positions rp
    JOIN episodes e ON e.id = rp.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE rp.tenant_id = sqlc.arg('tenant_id')
    AND rp.user_id = sqlc.arg('user_id')
    AND e.public_id = sqlc.arg('episode_public_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
    AND (
        el.price = 0
        OR EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = sqlc.arg('tenant_id')
                -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                AND p.user_id = sqlc.arg('user_id')::uuid
                AND p.episode_id = e.id
                AND (p.expires_at IS NULL OR p.expires_at > NOW())
        )
        OR EXISTS (
            SELECT 1
            FROM access_tickets at
            WHERE at.tenant_id = sqlc.arg('tenant_id')
                AND at.user_id = sqlc.arg('user_id')
                AND at.episode_id = e.id
                AND at.revoked_at IS NULL
                AND (at.expires_at IS NULL OR at.expires_at > NOW())
        )
    )
LIMIT 1;

-- name: GetMySeriesReadingProgress :one
-- The episode of one series the reader moved in most recently, with the
-- position they left and whether they already finished it. The series page
-- renders its call to action from this single private read, which is what
-- keeps the series detail itself shared-cacheable.
--
-- Episodes the reader can no longer open are skipped rather than reported, so
-- an expired rental hands the reader the episode before it instead of a
-- position they cannot act on.
SELECT e.public_id AS episode_public_id,
    e.title AS episode_title,
    e.order_index,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at,
    rp.page_index,
    rp.page_count,
    rp.updated_at,
    EXISTS (
        SELECT 1
        FROM episode_reads r
        WHERE r.tenant_id = rp.tenant_id
            AND r.user_id = rp.user_id
            AND r.episode_id = rp.episode_id
    ) AS is_finished
FROM episode_reading_positions rp
    JOIN episodes e ON e.id = rp.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
WHERE rp.tenant_id = sqlc.arg('tenant_id')
    AND rp.user_id = sqlc.arg('user_id')
    AND s.public_id = sqlc.arg('series_public_id')
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
    AND (
        el.price = 0
        OR EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = sqlc.arg('tenant_id')
                -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                AND p.user_id = sqlc.arg('user_id')::uuid
                AND p.episode_id = e.id
                AND (p.expires_at IS NULL OR p.expires_at > NOW())
        )
        OR EXISTS (
            SELECT 1
            FROM access_tickets at
            WHERE at.tenant_id = sqlc.arg('tenant_id')
                AND at.user_id = sqlc.arg('user_id')
                AND at.episode_id = e.id
                AND at.revoked_at IS NULL
                AND (at.expires_at IS NULL OR at.expires_at > NOW())
        )
    )
ORDER BY rp.updated_at DESC,
    rp.episode_id DESC
LIMIT 1;
