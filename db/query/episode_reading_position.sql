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
                FROM episode_free_windows fw
                WHERE fw.episode_id = e.id
                    AND fw.starts_at <= NOW()
                    AND fw.ends_at > NOW()
            )
            OR EXISTS (
                SELECT 1
                FROM purchases p
                WHERE p.tenant_id = sqlc.arg('tenant_id')
                    -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                    AND p.user_id = sqlc.arg('user_id')::uuid
                    AND p.episode_id = e.id
                    AND (p.expires_at IS NULL OR p.expires_at > NOW())
                    AND p.refunded_at IS NULL
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
            FROM episode_free_windows fw
            WHERE fw.episode_id = e.id
                AND fw.starts_at <= NOW()
                AND fw.ends_at > NOW()
        )
        OR EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = sqlc.arg('tenant_id')
                -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                AND p.user_id = sqlc.arg('user_id')::uuid
                AND p.episode_id = e.id
                AND (p.expires_at IS NULL OR p.expires_at > NOW())
                AND p.refunded_at IS NULL
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
            FROM episode_free_windows fw
            WHERE fw.episode_id = e.id
                AND fw.starts_at <= NOW()
                AND fw.ends_at > NOW()
        )
        OR EXISTS (
            SELECT 1
            FROM purchases p
            WHERE p.tenant_id = sqlc.arg('tenant_id')
                -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                AND p.user_id = sqlc.arg('user_id')::uuid
                AND p.episode_id = e.id
                AND (p.expires_at IS NULL OR p.expires_at > NOW())
                AND p.refunded_at IS NULL
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

-- name: ListMyRecentSeriesDesc :many
-- The series the reader is in the middle of, their newest activity first, each
-- with the episode a "continue reading" offer should open.
--
-- Activity is either half of what a reader leaves behind: a saved position and
-- a finished mark both count, and the newer of the two is when they last moved
-- in that episode. The two writes happen at different moments of the same
-- reading, so taking only one of them would lose a reader who finished
-- episodes without ever saving a page, and would freeze a series at the last
-- page saved in it.
--
-- The episode to continue from is the one the last activity is on while it is
-- still unfinished, and otherwise the first published episode after it the
-- reader has not finished. A series whose published episodes are all finished
-- produces no such episode and is dropped by the join, which is what takes it
-- out of the list until another episode is published.
--
-- Publication decides what may be named, and body access decides only what may
-- be resumed. An episode the reader has not bought is still the one they are
-- meant to open next, because its own page is where they buy it; its saved
-- position is withheld, because a page they cannot reach is not a place to
-- resume. Episodes of an unpublished series are dropped ahead of all of that,
-- so a series taken down reads like one that was never opened.
--
-- The sort key is an aggregate over the reader's own rows rather than a stored
-- column, so no index orders it directly. Both halves of the scan start from
-- the (tenant_id, user_id) prefix of their primary keys, which bounds the work
-- by one reader's history instead of by the tenant's.
--
-- Backward calls ListMyRecentSeriesAsc, and the caller sorts the rows back.
-- cursor rules: proto/README.md.
WITH touched AS (
    SELECT rp.episode_id,
        rp.updated_at AS activity_at
    FROM episode_reading_positions rp
    WHERE rp.tenant_id = sqlc.arg('tenant_id')
        AND rp.user_id = sqlc.arg('user_id')
    UNION ALL
    SELECT er.episode_id,
        er.read_at AS activity_at
    FROM episode_reads er
    WHERE er.tenant_id = sqlc.arg('tenant_id')
        AND er.user_id = sqlc.arg('user_id')
),
touched_episodes AS (
    SELECT e.series_id,
        e.id AS episode_id,
        e.order_index,
        MAX(t.activity_at)::timestamptz AS activity_at
    FROM touched t
        JOIN episodes e ON e.id = t.episode_id
        JOIN series s ON s.id = e.series_id
        JOIN episode_listings el ON el.episode_id = e.id
    WHERE e.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
    GROUP BY e.series_id,
        e.id,
        e.order_index
),
current_episode AS (
    SELECT DISTINCT ON (te.series_id) te.series_id,
        te.episode_id,
        te.order_index,
        te.activity_at AS last_activity_at
    FROM touched_episodes te
    ORDER BY te.series_id,
        te.activity_at DESC,
        te.order_index DESC,
        te.episode_id DESC
),
continue_from AS (
    SELECT ce.series_id,
        ce.last_activity_at,
        CASE
            WHEN NOT EXISTS (
                SELECT 1
                FROM episode_reads cr
                WHERE cr.tenant_id = sqlc.arg('tenant_id')
                    AND cr.user_id = sqlc.arg('user_id')
                    AND cr.episode_id = ce.episode_id
            ) THEN ce.episode_id
            ELSE (
                SELECT n.id
                FROM episodes n
                    JOIN episode_listings nl ON nl.episode_id = n.id
                WHERE n.tenant_id = sqlc.arg('tenant_id')
                    AND n.series_id = ce.series_id
                    AND (n.order_index, n.id) > (ce.order_index, ce.episode_id)
                    AND nl.status = 'published'
                    AND nl.published_at IS NOT NULL
                    AND nl.published_at <= NOW()
                    AND NOT EXISTS (
                        SELECT 1
                        FROM episode_reads nr
                        WHERE nr.tenant_id = sqlc.arg('tenant_id')
                            AND nr.user_id = sqlc.arg('user_id')
                            AND nr.episode_id = n.id
                    )
                ORDER BY n.order_index ASC,
                    n.id ASC
                LIMIT 1
            )
        END AS episode_id
    FROM current_episode ce
)
SELECT cf.series_id,
    cf.last_activity_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    e.order_index,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at,
    rp.page_index,
    rp.page_count,
    rp.updated_at AS position_updated_at
FROM continue_from cf
    JOIN episodes e ON e.id = cf.episode_id
    JOIN episode_listings el ON el.episode_id = e.id
    LEFT JOIN episode_reading_positions rp ON rp.tenant_id = sqlc.arg('tenant_id')
        AND rp.user_id = sqlc.arg('user_id')
        AND rp.episode_id = e.id
        AND (
            el.price = 0
            OR EXISTS (
                SELECT 1
                FROM episode_free_windows fw
                WHERE fw.episode_id = e.id
                    AND fw.starts_at <= NOW()
                    AND fw.ends_at > NOW()
            )
            OR EXISTS (
                SELECT 1
                FROM purchases p
                WHERE p.tenant_id = sqlc.arg('tenant_id')
                    -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                    AND p.user_id = sqlc.arg('user_id')::uuid
                    AND p.episode_id = e.id
                    AND (p.expires_at IS NULL OR p.expires_at > NOW())
                    AND p.refunded_at IS NULL
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
WHERE (
        sqlc.narg('cursor_last_activity_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (cf.last_activity_at, cf.series_id) <= (
                sqlc.narg('cursor_last_activity_at')::timestamptz,
                sqlc.narg('cursor_series_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (cf.last_activity_at, cf.series_id) < (
                sqlc.narg('cursor_last_activity_at')::timestamptz,
                sqlc.narg('cursor_series_id')::uuid
            )
        )
    )
ORDER BY cf.last_activity_at DESC,
    cf.series_id DESC
LIMIT sqlc.arg('limit');

-- name: ListMyRecentSeriesAsc :many
-- The backward direction of ListMyRecentSeriesDesc.
WITH touched AS (
    SELECT rp.episode_id,
        rp.updated_at AS activity_at
    FROM episode_reading_positions rp
    WHERE rp.tenant_id = sqlc.arg('tenant_id')
        AND rp.user_id = sqlc.arg('user_id')
    UNION ALL
    SELECT er.episode_id,
        er.read_at AS activity_at
    FROM episode_reads er
    WHERE er.tenant_id = sqlc.arg('tenant_id')
        AND er.user_id = sqlc.arg('user_id')
),
touched_episodes AS (
    SELECT e.series_id,
        e.id AS episode_id,
        e.order_index,
        MAX(t.activity_at)::timestamptz AS activity_at
    FROM touched t
        JOIN episodes e ON e.id = t.episode_id
        JOIN series s ON s.id = e.series_id
        JOIN episode_listings el ON el.episode_id = e.id
    WHERE e.tenant_id = sqlc.arg('tenant_id')
        AND s.is_published = true
        AND s.published_at IS NOT NULL
        AND s.published_at <= NOW()
        AND el.status = 'published'
        AND el.published_at IS NOT NULL
        AND el.published_at <= NOW()
    GROUP BY e.series_id,
        e.id,
        e.order_index
),
current_episode AS (
    SELECT DISTINCT ON (te.series_id) te.series_id,
        te.episode_id,
        te.order_index,
        te.activity_at AS last_activity_at
    FROM touched_episodes te
    ORDER BY te.series_id,
        te.activity_at DESC,
        te.order_index DESC,
        te.episode_id DESC
),
continue_from AS (
    SELECT ce.series_id,
        ce.last_activity_at,
        CASE
            WHEN NOT EXISTS (
                SELECT 1
                FROM episode_reads cr
                WHERE cr.tenant_id = sqlc.arg('tenant_id')
                    AND cr.user_id = sqlc.arg('user_id')
                    AND cr.episode_id = ce.episode_id
            ) THEN ce.episode_id
            ELSE (
                SELECT n.id
                FROM episodes n
                    JOIN episode_listings nl ON nl.episode_id = n.id
                WHERE n.tenant_id = sqlc.arg('tenant_id')
                    AND n.series_id = ce.series_id
                    AND (n.order_index, n.id) > (ce.order_index, ce.episode_id)
                    AND nl.status = 'published'
                    AND nl.published_at IS NOT NULL
                    AND nl.published_at <= NOW()
                    AND NOT EXISTS (
                        SELECT 1
                        FROM episode_reads nr
                        WHERE nr.tenant_id = sqlc.arg('tenant_id')
                            AND nr.user_id = sqlc.arg('user_id')
                            AND nr.episode_id = n.id
                    )
                ORDER BY n.order_index ASC,
                    n.id ASC
                LIMIT 1
            )
        END AS episode_id
    FROM current_episode ce
)
SELECT cf.series_id,
    cf.last_activity_at,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    e.order_index,
    el.price,
    el.reading_period_hours,
    el.status,
    el.scheduled_at,
    el.published_at,
    rp.page_index,
    rp.page_count,
    rp.updated_at AS position_updated_at
FROM continue_from cf
    JOIN episodes e ON e.id = cf.episode_id
    JOIN episode_listings el ON el.episode_id = e.id
    LEFT JOIN episode_reading_positions rp ON rp.tenant_id = sqlc.arg('tenant_id')
        AND rp.user_id = sqlc.arg('user_id')
        AND rp.episode_id = e.id
        AND (
            el.price = 0
            OR EXISTS (
                SELECT 1
                FROM episode_free_windows fw
                WHERE fw.episode_id = e.id
                    AND fw.starts_at <= NOW()
                    AND fw.ends_at > NOW()
            )
            OR EXISTS (
                SELECT 1
                FROM purchases p
                WHERE p.tenant_id = sqlc.arg('tenant_id')
                    -- The cast keeps this a plain uuid: a deleted buyer's NULL is nobody's grant.
                    AND p.user_id = sqlc.arg('user_id')::uuid
                    AND p.episode_id = e.id
                    AND (p.expires_at IS NULL OR p.expires_at > NOW())
                    AND p.refunded_at IS NULL
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
WHERE (
        sqlc.narg('cursor_last_activity_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (cf.last_activity_at, cf.series_id) >= (
                sqlc.narg('cursor_last_activity_at')::timestamptz,
                sqlc.narg('cursor_series_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (cf.last_activity_at, cf.series_id) > (
                sqlc.narg('cursor_last_activity_at')::timestamptz,
                sqlc.narg('cursor_series_id')::uuid
            )
        )
    )
ORDER BY cf.last_activity_at ASC,
    cf.series_id ASC
LIMIT sqlc.arg('limit');
