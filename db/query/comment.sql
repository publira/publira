-- Reader comments on published episodes.
--
-- Every state transition is an UPDATE on the single episode_comments row, so
-- the WHERE clause of each one names the status it is allowed to move from and
-- the query returns no row when the comment was already moved by someone else.
-- The caller tells "not found" from "already handled" by that.
--
-- Expected plans:
--   ListPublishedEpisodeCommentsByCreatedAt*
--     -> idx_episode_comments_tenant_episode_status_created_at
--   ListUserPendingOrHiddenEpisodeCommentsByCreatedAt*
--     -> idx_episode_comments_tenant_user_created_at
--   ListEpisodeCommentsForModerationByCreatedAt*
--     -> idx_episode_comments_tenant_user_created_at with a user filter,
--        idx_episode_comments_tenant_status_created_at with a status filter,
--        idx_episode_comments_tenant_created_at without either
--   CountPendingEpisodeCommentsForTenant
--     -> idx_episode_comments_tenant_status_created_at
--   PurgeWithdrawnEpisodeComments
--     -> idx_episode_comments_tenant_withdrawn_at
--   CountWithdrawnEpisodeCommentsBefore
--     -> idx_episode_comments_tenant_withdrawn_at

-- name: CreateEpisodeComment :one
-- status and published_at come from the tenant's comment_mode: 'published' with
-- a timestamp under immediate, 'pending' with NULL under approval_required.
INSERT INTO episode_comments (
    id,
    tenant_id,
    public_id,
    episode_id,
    user_id,
    body,
    status,
    published_at
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('public_id'),
    sqlc.arg('episode_id'),
    sqlc.arg('user_id'),
    sqlc.arg('body'),
    sqlc.arg('status'),
    sqlc.narg('published_at')
)
RETURNING *;

-- name: ListPublishedEpisodeCommentsByCreatedAtDesc :many
-- The public list of one episode. Only 'published' rows appear here, so a
-- pending, removed, or withdrawn comment is absent for every reader; the author
-- sees their own through ListUserPendingOrHiddenEpisodeCommentsByCreatedAt*.
--
-- The creator columns name the credit the author holds on this episode, and
-- are NULL for a comment by anyone the episode does not credit:
-- credited_creator_of_account answers per row, so the mark costs this query a
-- lookup per comment rather than the handler a query per comment.
SELECT c.id,
    c.public_id,
    c.body,
    c.created_at,
    c.user_id,
    u.public_id AS author_public_id,
    u.name AS author_name,
    cc.id AS creator_id,
    cc.public_id AS creator_public_id,
    cc.name AS creator_name
FROM episode_comments c
    JOIN users u ON u.tenant_id = c.tenant_id
        AND u.id = c.user_id
    LEFT JOIN creators cc ON cc.id = credited_creator_of_account(c.tenant_id, c.user_id, c.episode_id)
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.episode_id = sqlc.arg('episode_id')
    AND c.status = 'published'
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) <= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) < (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.created_at DESC,
    c.id DESC
LIMIT sqlc.arg('limit');

-- name: ListPublishedEpisodeCommentsByCreatedAtAsc :many
-- The previous-page half of ListPublishedEpisodeCommentsByCreatedAtDesc. The
-- handler reverses the returned rows to preserve the newest-first display order.
SELECT c.id,
    c.public_id,
    c.body,
    c.created_at,
    c.user_id,
    u.public_id AS author_public_id,
    u.name AS author_name,
    cc.id AS creator_id,
    cc.public_id AS creator_public_id,
    cc.name AS creator_name
FROM episode_comments c
    JOIN users u ON u.tenant_id = c.tenant_id
        AND u.id = c.user_id
    LEFT JOIN creators cc ON cc.id = credited_creator_of_account(c.tenant_id, c.user_id, c.episode_id)
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.episode_id = sqlc.arg('episode_id')
    AND c.status = 'published'
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) >= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) > (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.created_at ASC,
    c.id ASC
LIMIT sqlc.arg('limit');

-- name: ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDesc :many
-- The viewer's own comments on one episode that the public list of that episode
-- cannot carry. Their published ones are already in it, and listing them here
-- as well would only make the site reconcile two copies of the same comment.
--
-- A comment removed by staff or by the report threshold stays in this list
-- exactly as it was: the removal is told through a notification, not by the
-- comment changing shape here. Only the author's own withdrawal takes it
-- away from them.
--
-- The creator columns are the ones the public list carries, so the author's
-- comment is marked the same way before it is published as after.
SELECT c.id,
    c.public_id,
    c.episode_id,
    c.body,
    c.status,
    c.created_at,
    c.published_at,
    cc.id AS creator_id,
    cc.public_id AS creator_public_id,
    cc.name AS creator_name
FROM episode_comments c
    LEFT JOIN creators cc ON cc.id = credited_creator_of_account(c.tenant_id, c.user_id, c.episode_id)
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.user_id = sqlc.arg('user_id')
    AND c.episode_id = sqlc.arg('episode_id')
    AND c.status IN ('pending', 'hidden')
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) <= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) < (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.created_at DESC,
    c.id DESC
LIMIT sqlc.arg('limit');

-- name: ListUserPendingOrHiddenEpisodeCommentsByCreatedAtAsc :many
-- The previous-page half of
-- ListUserPendingOrHiddenEpisodeCommentsByCreatedAtDesc.
SELECT c.id,
    c.public_id,
    c.episode_id,
    c.body,
    c.status,
    c.created_at,
    c.published_at,
    cc.id AS creator_id,
    cc.public_id AS creator_public_id,
    cc.name AS creator_name
FROM episode_comments c
    LEFT JOIN creators cc ON cc.id = credited_creator_of_account(c.tenant_id, c.user_id, c.episode_id)
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.user_id = sqlc.arg('user_id')
    AND c.episode_id = sqlc.arg('episode_id')
    AND c.status IN ('pending', 'hidden')
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) >= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) > (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.created_at ASC,
    c.id ASC
LIMIT sqlc.arg('limit');

-- name: GetEpisodeCommentCreatorForUser :one
-- The credit a comment the reader posts now is shown under: the one the
-- comment lists read through the same function. The post response carries it,
-- so the author's new comment is marked before either list has re-read it. No
-- row means the reader is not a creator this episode credits.
SELECT cc.id,
    cc.public_id,
    cc.name
FROM creators cc
WHERE cc.id = credited_creator_of_account(
        sqlc.arg('tenant_id')::uuid,
        sqlc.arg('user_id')::uuid,
        sqlc.arg('episode_id')::uuid
    );

-- name: ListEpisodeCommentsForModerationByCreatedAtDesc :many
-- The console queues: 'pending' is the approval queue, 'hidden' the removed
-- comments staff can restore, 'withdrawn' what an author deleted and the
-- retention window still keeps. Every filter is optional, so the same query
-- answers a tenant-wide queue, one series, one episode, one reader, and the
-- whole history of any of them; a moderator does not have to open an episode to
-- find work.
--
-- The author and the episode are joined in because a comment cannot be judged
-- from its text alone: staff need to know who wrote it and what it is about.
SELECT c.*,
    u.public_id AS author_public_id,
    u.name AS author_name,
    EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    ) AS author_is_staff,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_comments c
    JOIN users u ON u.tenant_id = c.tenant_id
        AND u.id = c.user_id
    JOIN episodes e ON e.tenant_id = c.tenant_id
        AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (sqlc.narg('status')::text IS NULL OR c.status = sqlc.narg('status')::text)
    AND (sqlc.narg('episode_id')::uuid IS NULL OR c.episode_id = sqlc.narg('episode_id')::uuid)
    AND (sqlc.narg('series_id')::uuid IS NULL OR e.series_id = sqlc.narg('series_id')::uuid)
    AND (sqlc.narg('user_id')::uuid IS NULL OR c.user_id = sqlc.narg('user_id')::uuid)
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) <= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) < (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.created_at DESC,
    c.id DESC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeCommentsForModerationByCreatedAtAsc :many
-- The previous-page half of ListEpisodeCommentsForModerationByCreatedAtDesc.
SELECT c.*,
    u.public_id AS author_public_id,
    u.name AS author_name,
    EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    ) AS author_is_staff,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_comments c
    JOIN users u ON u.tenant_id = c.tenant_id
        AND u.id = c.user_id
    JOIN episodes e ON e.tenant_id = c.tenant_id
        AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND (sqlc.narg('status')::text IS NULL OR c.status = sqlc.narg('status')::text)
    AND (sqlc.narg('episode_id')::uuid IS NULL OR c.episode_id = sqlc.narg('episode_id')::uuid)
    AND (sqlc.narg('series_id')::uuid IS NULL OR e.series_id = sqlc.narg('series_id')::uuid)
    AND (sqlc.narg('user_id')::uuid IS NULL OR c.user_id = sqlc.narg('user_id')::uuid)
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) >= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (c.created_at, c.id) > (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY c.created_at ASC,
    c.id ASC
LIMIT sqlc.arg('limit');

-- name: CountPendingEpisodeCommentsForTenant :one
-- The size of the approval queue, for the console navigation that carries it on
-- every screen. Counting is a query of its own rather than the length of a
-- list page: the badge needs the whole queue, and a page bounded by a limit
-- cannot report it.
SELECT COUNT(*)::int AS pending_count
FROM episode_comments
WHERE tenant_id = sqlc.arg('tenant_id')
    AND status = 'pending';

-- name: GetEpisodeCommentForModerationByIDForTenant :one
-- One comment in the shape the moderation list returns. Every moderation action
-- reads it before deciding and again after writing, so the caller answers from
-- the stored row rather than from what it assumed the transition would produce.
SELECT c.*,
    u.public_id AS author_public_id,
    u.name AS author_name,
    EXISTS (
        SELECT 1
        FROM tenant_user_roles tur
        WHERE tur.user_id = u.id
    ) AS author_is_staff,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_comments c
    JOIN users u ON u.tenant_id = c.tenant_id
        AND u.id = c.user_id
    JOIN episodes e ON e.tenant_id = c.tenant_id
        AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.id = sqlc.arg('id');

-- name: ApproveEpisodeCommentByIDForTenant :one
-- Approval is what publishes a comment posted under approval_required, so it is
-- also where published_at is first written.
UPDATE episode_comments
SET status = 'published',
    published_at = NOW(),
    approved_by = sqlc.arg('approved_by')::uuid,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND status = 'pending'
RETURNING *;

-- name: HideEpisodeCommentByIDForTenant :one
-- hidden_by is NULL when hidden_reason is 'auto_reports': the report threshold
-- has no staff actor to name.
UPDATE episode_comments
SET status = 'hidden',
    hidden_at = NOW(),
    hidden_by = sqlc.narg('hidden_by'),
    hidden_reason = sqlc.arg('hidden_reason')::text,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND status IN ('pending', 'published')
RETURNING *;

-- name: RestoreEpisodeCommentByIDForTenant :one
-- A restored comment returns to the state the removal interrupted, which
-- published_at records: one that was already public becomes public again, and
-- one removed while still awaiting approval goes back into that queue.
UPDATE episode_comments
SET status = CASE WHEN published_at IS NULL THEN 'pending' ELSE 'published' END,
    hidden_at = NULL,
    hidden_by = NULL,
    hidden_reason = NULL,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND status = 'hidden'
RETURNING *;

-- name: WithdrawEpisodeCommentForUser :one
-- The author's own deletion. It applies to a comment staff had removed too,
-- since the author still sees that comment unchanged. The removal columns
-- are cleared because no removal is in force on a withdrawn row any more;
-- audit_logs keeps what staff did and why.
UPDATE episode_comments
SET status = 'withdrawn',
    withdrawn_at = NOW(),
    hidden_at = NULL,
    hidden_by = NULL,
    hidden_reason = NULL,
    updated_at = NOW()
WHERE tenant_id = sqlc.arg('tenant_id')
    AND user_id = sqlc.arg('user_id')
    AND id = sqlc.arg('id')
    AND status <> 'withdrawn'
RETURNING *;

-- name: DeleteEpisodeCommentByIDForTenant :execrows
-- The irreversible removal staff reach for when the text must not be retained
-- at all. It names no status: content under a legal takedown has to go whatever
-- state it is in, and the reversible removal is a different query.
DELETE FROM episode_comments
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id');

-- name: PurgeWithdrawnEpisodeComments :execrows
-- The end of the retention window for a comment its author deleted. The inner
-- select bounds one chunk, so a tenant with a long backlog is drained over
-- several statements instead of one long-running delete.
DELETE FROM episode_comments
WHERE id IN (
    SELECT expired.id
    FROM episode_comments expired
    WHERE expired.tenant_id = sqlc.arg('tenant_id')
        AND expired.status = 'withdrawn'
        AND expired.withdrawn_at < sqlc.arg('cutoff')::timestamptz
    ORDER BY expired.withdrawn_at
    LIMIT sqlc.arg('limit')
);

-- name: CountWithdrawnEpisodeCommentsBefore :one
-- How much of one tenant's backlog the retention purge is about to take. It
-- answers that batch's dry run, which reports the total and deletes nothing.
SELECT count(*)
FROM episode_comments
WHERE tenant_id = sqlc.arg('tenant_id')
    AND status = 'withdrawn'
    AND withdrawn_at < sqlc.arg('cutoff')::timestamptz;
