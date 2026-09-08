-- Reader reports on episode comments, and the open-report counter they keep on
-- the comment they are about.
--
-- Expected plans:
--   GetReportableEpisodeCommentByPublicIDForTenant
--     -> episode_comments_tenant_public_id_key
--   CreateEpisodeCommentReport
--     -> episode_comment_reports_tenant_comment_reporter_key for the conflict
--   RefreshEpisodeCommentOpenReportCount
--     -> episode_comments_tenant_id_id_key, then
--        episode_comment_reports_tenant_comment_reporter_key for the count
--   ListEpisodeCommentReportsForModerationByCreatedAt*
--     -> idx_episode_comment_reports_tenant_status_created_at with a status
--        filter, idx_episode_comment_reports_tenant_created_at without one
--   GetEpisodeCommentReportForModerationByIDForTenant
--     -> episode_comment_reports_pkey
--   ResolveEpisodeCommentReportByIDForTenant
--     -> episode_comment_reports_pkey
--   RejectOpenEpisodeCommentReportsForComment
--     -> episode_comment_reports_tenant_comment_reporter_key

-- name: GetReportableEpisodeCommentByPublicIDForTenant :one
-- The comment a reader is allowed to report: one that is published, on an
-- episode that is itself public right now. The publication predicate is the one
-- GetPublishedEpisodeByPublicIDForTenant applies, so a comment on an episode
-- that has been unpublished since is as absent here as one that never existed.
--
-- Every join carries the tenant because the catalog's foreign keys are
-- single-column: episodes.series_id names a series without naming its tenant,
-- and so does episode_listings.episode_id. Only the tenant on each side keeps
-- the publication that is being read the same tenant's as the comment.
--
-- The author is returned because a reader may not report their own comment, and
-- that is a decision the caller makes rather than a row this query hides: the
-- two cases are told apart in the answer the reporter gets.
--
-- The episode and the series the joins already visit are returned with it. The
-- staff notification the report raises names what the queue is about, and
-- reading it here keeps the report one round trip.
SELECT c.id,
    c.user_id,
    c.episode_id,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_comments c
    JOIN episodes e ON e.tenant_id = c.tenant_id
        AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = c.tenant_id
        AND s.id = e.series_id
    JOIN episode_listings el ON el.tenant_id = c.tenant_id
        AND el.episode_id = e.id
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.public_id = sqlc.arg('public_id')
    AND c.status = 'published'
    AND s.is_published = true
    AND s.published_at IS NOT NULL
    AND s.published_at <= NOW()
    AND el.status = 'published'
    AND el.published_at IS NOT NULL
    AND el.published_at <= NOW()
LIMIT 1;

-- name: CreateEpisodeCommentReport :one
-- One reader's report. A reader who has already reported this comment conflicts
-- with the unique constraint and no row is returned, which is how the caller
-- tells a first report from a repeat without asking first: asking would leave a
-- window in which two concurrent submissions both believed they were the first.
--
-- A repeat is deliberately not an update. The reason and the note are what the
-- reader said the first time, and the report queue is worked from them.
INSERT INTO episode_comment_reports (
    id,
    tenant_id,
    comment_id,
    reporter_user_id,
    reason,
    note
) VALUES (
    sqlc.arg('id'),
    sqlc.arg('tenant_id'),
    sqlc.arg('comment_id'),
    sqlc.arg('reporter_user_id'),
    sqlc.arg('reason'),
    sqlc.narg('note')
)
ON CONFLICT (tenant_id, comment_id, reporter_user_id) DO NOTHING
RETURNING *;

-- name: RefreshEpisodeCommentOpenReportCount :one
-- Recomputes the counter from the reports themselves, in the transaction that
-- just changed one of them.
--
-- Recomputing rather than adding one is what makes the counter answer the same
-- question after a resolution as after a report: staff deciding on a report
-- lowers it by exactly the rows that stopped being open, and a counter that had
-- drifted for any reason is corrected by the next write instead of staying
-- wrong until someone notices.
UPDATE episode_comments c
SET open_report_count = (
        SELECT COUNT(*)
        FROM episode_comment_reports r
        WHERE r.tenant_id = c.tenant_id
            AND r.comment_id = c.id
            AND r.status = 'open'
    )
WHERE c.tenant_id = sqlc.arg('tenant_id')
    AND c.id = sqlc.arg('comment_id')
RETURNING c.open_report_count;

-- name: ListEpisodeCommentReportsForModerationByCreatedAtDesc :many
-- The report queue: one row per report rather than per reported comment,
-- because a report is what staff decide on. A comment several readers reported
-- is therefore here once per report, and open_report_count on it says how many
-- of those are still waiting.
--
-- The reported comment travels with the report, joined the same way
-- ListEpisodeCommentsForModerationByCreatedAtDesc joins it: a report cannot be
-- judged without the text it is about, and the queue offers the removal
-- actions from the same row.
SELECT r.id AS report_id,
    r.reason,
    r.note,
    r.status AS report_status,
    r.created_at AS report_created_at,
    r.resolved_at,
    reporter.public_id AS reporter_public_id,
    reporter.name AS reporter_name,
    c.id,
    c.public_id,
    c.body,
    c.status,
    c.hidden_reason,
    c.created_at,
    c.published_at,
    c.hidden_at,
    c.withdrawn_at,
    c.open_report_count,
    u.public_id AS author_public_id,
    u.name AS author_name,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_comment_reports r
    JOIN episode_comments c ON c.tenant_id = r.tenant_id
        AND c.id = r.comment_id
    JOIN users reporter ON reporter.tenant_id = r.tenant_id
        AND reporter.id = r.reporter_user_id
    JOIN users u ON u.tenant_id = c.tenant_id
        AND u.id = c.user_id
    JOIN episodes e ON e.tenant_id = c.tenant_id
        AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND (sqlc.narg('status')::text IS NULL OR r.status = sqlc.narg('status')::text)
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (r.created_at, r.id) <= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (r.created_at, r.id) < (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY r.created_at DESC,
    r.id DESC
LIMIT sqlc.arg('limit');

-- name: ListEpisodeCommentReportsForModerationByCreatedAtAsc :many
-- The previous-page half of ListEpisodeCommentReportsForModerationByCreatedAtDesc.
-- The handler reverses the returned rows to preserve the newest-first order.
SELECT r.id AS report_id,
    r.reason,
    r.note,
    r.status AS report_status,
    r.created_at AS report_created_at,
    r.resolved_at,
    reporter.public_id AS reporter_public_id,
    reporter.name AS reporter_name,
    c.id,
    c.public_id,
    c.body,
    c.status,
    c.hidden_reason,
    c.created_at,
    c.published_at,
    c.hidden_at,
    c.withdrawn_at,
    c.open_report_count,
    u.public_id AS author_public_id,
    u.name AS author_name,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_comment_reports r
    JOIN episode_comments c ON c.tenant_id = r.tenant_id
        AND c.id = r.comment_id
    JOIN users reporter ON reporter.tenant_id = r.tenant_id
        AND reporter.id = r.reporter_user_id
    JOIN users u ON u.tenant_id = c.tenant_id
        AND u.id = c.user_id
    JOIN episodes e ON e.tenant_id = c.tenant_id
        AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND (sqlc.narg('status')::text IS NULL OR r.status = sqlc.narg('status')::text)
    AND (
        sqlc.narg('cursor_created_at')::timestamptz IS NULL
        OR (
            sqlc.arg('cursor_inclusive')::boolean
            AND (r.created_at, r.id) >= (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
        OR (
            NOT sqlc.arg('cursor_inclusive')::boolean
            AND (r.created_at, r.id) > (
                sqlc.narg('cursor_created_at')::timestamptz,
                sqlc.narg('cursor_id')::uuid
            )
        )
    )
ORDER BY r.created_at ASC,
    r.id ASC
LIMIT sqlc.arg('limit');

-- name: GetEpisodeCommentReportForModerationByIDForTenant :one
-- One report in the shape the queue returns. A decision reads it before acting
-- and again after writing, so the answer describes the stored rows rather than
-- what the transition was assumed to produce.
SELECT r.id AS report_id,
    r.reason,
    r.note,
    r.status AS report_status,
    r.created_at AS report_created_at,
    r.resolved_at,
    reporter.public_id AS reporter_public_id,
    reporter.name AS reporter_name,
    c.id,
    c.public_id,
    c.body,
    c.status,
    c.hidden_reason,
    c.created_at,
    c.published_at,
    c.hidden_at,
    c.withdrawn_at,
    c.open_report_count,
    u.public_id AS author_public_id,
    u.name AS author_name,
    e.public_id AS episode_public_id,
    e.title AS episode_title,
    s.public_id AS series_public_id,
    s.title AS series_title
FROM episode_comment_reports r
    JOIN episode_comments c ON c.tenant_id = r.tenant_id
        AND c.id = r.comment_id
    JOIN users reporter ON reporter.tenant_id = r.tenant_id
        AND reporter.id = r.reporter_user_id
    JOIN users u ON u.tenant_id = c.tenant_id
        AND u.id = c.user_id
    JOIN episodes e ON e.tenant_id = c.tenant_id
        AND e.id = c.episode_id
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND r.id = sqlc.arg('id');

-- name: ResolveEpisodeCommentReportByIDForTenant :one
-- Staff deciding one report, either way. It names 'open' as the state it moves
-- from, so a report a second moderator decided in between returns no row and
-- the caller answers "already decided" rather than overwriting the first
-- decision.
--
-- The comment is untouched here: agreeing with a report is not the same act as
-- removing what it is about. Only the counter follows, through
-- RefreshEpisodeCommentOpenReportCount in the same transaction.
UPDATE episode_comment_reports
SET status = sqlc.arg('status')::text,
    resolved_at = NOW(),
    resolved_by = sqlc.arg('resolved_by')::uuid
WHERE tenant_id = sqlc.arg('tenant_id')
    AND id = sqlc.arg('id')
    AND status = 'open'
RETURNING *;

-- name: RejectOpenEpisodeCommentReportsForComment :execrows
-- Every open report on one comment, decided at once by a restore.
--
-- Putting a removed comment back is staff saying the comment stands, so the
-- reports against it do not; leaving them open would let the same reports carry
-- the comment past the removal threshold again the moment it came back.
UPDATE episode_comment_reports
SET status = 'rejected',
    resolved_at = NOW(),
    resolved_by = sqlc.arg('resolved_by')::uuid
WHERE tenant_id = sqlc.arg('tenant_id')
    AND comment_id = sqlc.arg('comment_id')
    AND status = 'open';
