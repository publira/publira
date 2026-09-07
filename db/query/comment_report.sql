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

-- name: GetReportableEpisodeCommentByPublicIDForTenant :one
-- The comment a reader is allowed to report: one that is published, on an
-- episode that is itself public right now. The publication predicate is the one
-- GetPublishedEpisodeByPublicIDForTenant applies, so a comment on an episode
-- that has been unpublished since is as absent here as one that never existed.
--
-- The author is returned because a reader may not report their own comment, and
-- that is a decision the caller makes rather than a row this query hides: the
-- two cases are told apart in the answer the reporter gets.
SELECT c.id,
    c.user_id,
    c.episode_id
FROM episode_comments c
    JOIN episodes e ON e.tenant_id = c.tenant_id
        AND e.id = c.episode_id
    JOIN series s ON s.id = e.series_id
    JOIN episode_listings el ON el.episode_id = e.id
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
