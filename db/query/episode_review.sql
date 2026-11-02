-- name: GetTenantEpisodeReviewRequired :one
-- A tenant with no config row requires no review, as the column's default
-- says.
SELECT COALESCE((
        SELECT tc.episode_review_required
        FROM tenant_config tc
        WHERE tc.tenant_id = sqlc.arg('tenant_id')
    ), false)::boolean AS episode_review_required;

-- name: LockEpisodeListingForReview :one
-- The listing a review step reads and writes, locked so a submission, a
-- decision, and the publication job's promotion of the same episode happen one
-- after another.
SELECT el.episode_id,
    e.public_id AS episode_public_id,
    e.series_id,
    el.status,
    el.scheduled_at,
    el.review_state,
    el.review_approved_at
FROM episode_listings el
    JOIN episodes e ON e.tenant_id = el.tenant_id
        AND e.id = el.episode_id
WHERE el.tenant_id = sqlc.arg('tenant_id')
    AND el.episode_id = sqlc.arg('episode_id')
FOR UPDATE OF el;

-- name: OpenEpisodeReview :exec
-- Opens a round for the episode, or leaves the one already open as it is: a
-- second save while an episode waits for a decision is still the same
-- submission.
INSERT INTO episode_reviews (id, tenant_id, episode_id, submitted_by_user_id)
VALUES (
        uuidv7(),
        sqlc.arg('tenant_id'),
        sqlc.arg('episode_id'),
        sqlc.narg('submitted_by_user_id')
    )
ON CONFLICT (episode_id) WHERE decision IS NULL DO NOTHING;

-- name: WithdrawEpisodeReview :exec
-- The open round of an episode taken back to a draft. It was decided by no one
-- and says nothing, so it is deleted rather than kept beside the rounds that
-- were.
DELETE FROM episode_reviews
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = sqlc.arg('episode_id')
    AND decision IS NULL;

-- name: SetEpisodeListingReviewState :exec
UPDATE episode_listings
SET review_state = sqlc.narg('review_state')::text,
    review_approved_at = sqlc.narg('review_approved_at')::timestamptz
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = sqlc.arg('episode_id');

-- name: DecideEpisodeReview :one
-- Closes the open round with a Tenant admin's decision. An episode with no
-- open round answers no row.
UPDATE episode_reviews
SET decision = sqlc.arg('decision')::text,
    decided_by_user_id = sqlc.narg('decided_by_user_id'),
    decided_at = NOW(),
    comment = sqlc.narg('comment')::text
WHERE tenant_id = sqlc.arg('tenant_id')
    AND episode_id = sqlc.arg('episode_id')
    AND decision IS NULL
RETURNING id,
    submitted_by_user_id,
    decided_at;

-- name: ReopenApprovedEpisodeReviews :many
-- An episode edited after it was approved is no longer what was approved, so
-- the edit takes the approval back and opens a round in the editor's name. It
-- does so only while the episode waits for its time and its tenant requires
-- review: a published episode is not reviewed again, and with review off an
-- approval holds nothing back. One statement for every episode an edit
-- touched, which a bulk edit of a series' credits makes many of; it answers
-- the public id of each episode it reopened, which the submission is recorded
-- under.
WITH reopened AS (
    UPDATE episode_listings el
    SET review_state = 'in_review',
        review_approved_at = NULL
    WHERE el.tenant_id = sqlc.arg('tenant_id')
        AND el.episode_id = ANY (sqlc.arg('episode_ids')::uuid [])
        AND el.status = 'scheduled'
        AND el.review_state = 'approved'
        AND EXISTS (
            SELECT 1
            FROM tenant_config tc
            WHERE tc.tenant_id = el.tenant_id
                AND tc.episode_review_required
        )
    RETURNING el.tenant_id,
        el.episode_id
),
opened AS (
    INSERT INTO episode_reviews (id, tenant_id, episode_id, submitted_by_user_id)
    SELECT uuidv7(),
        reopened.tenant_id,
        reopened.episode_id,
        sqlc.narg('submitted_by_user_id')
    FROM reopened
    ON CONFLICT (episode_id) WHERE decision IS NULL DO NOTHING
    RETURNING tenant_id,
        episode_id
)
SELECT e.public_id
FROM opened
    JOIN episodes e ON e.tenant_id = opened.tenant_id
        AND e.id = opened.episode_id
ORDER BY e.public_id;

-- name: SubmitScheduledEpisodesForReview :execrows
-- Turning review on puts every scheduled episode of the tenant in review, so
-- the episodes it now holds back are the ones a Tenant admin is shown to
-- decide on, rather than waiting where nobody looks. An approval given before
-- review was last turned off is taken back with the rest: the episode may have
-- been edited since without anyone reviewing it. The rounds are opened in no
-- one's name, because nobody submitted them.
WITH submitted AS (
    UPDATE episode_listings el
    SET review_state = 'in_review',
        review_approved_at = NULL
    WHERE el.tenant_id = sqlc.arg('tenant_id')
        AND el.status = 'scheduled'
    RETURNING el.tenant_id,
        el.episode_id
)
INSERT INTO episode_reviews (id, tenant_id, episode_id)
SELECT uuidv7(),
    submitted.tenant_id,
    submitted.episode_id
FROM submitted
ON CONFLICT (episode_id) WHERE decision IS NULL DO NOTHING;

-- name: ListEpisodeReviews :many
-- Every round of one episode, oldest first, with who submitted and who decided
-- it. A deleted account reads as no one.
SELECT r.id,
    r.submitted_at,
    r.decision,
    r.decided_at,
    r.comment,
    COALESCE(submitter.public_id, ''::text) AS submitted_by_public_id,
    COALESCE(submitter.name, ''::text) AS submitted_by_name,
    COALESCE(decider.public_id, ''::text) AS decided_by_public_id,
    COALESCE(decider.name, ''::text) AS decided_by_name
FROM episode_reviews r
    LEFT JOIN users submitter ON submitter.tenant_id = r.tenant_id
        AND submitter.id = r.submitted_by_user_id
    LEFT JOIN users decider ON decider.tenant_id = r.tenant_id
        AND decider.id = r.decided_by_user_id
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND r.episode_id = sqlc.arg('episode_id')
ORDER BY r.submitted_at ASC,
    r.id ASC;

-- name: ListLatestEpisodeReviewsByEpisodeIDs :many
-- The review state of each of the episodes a console read answers, with the
-- round that state comes from. An episode no round was opened for answers no
-- row.
SELECT el.episode_id,
    el.review_state::text AS review_state,
    el.review_approved_at,
    latest.submitted_at,
    latest.decided_at,
    latest.comment
FROM episode_listings el
    CROSS JOIN LATERAL (
        SELECT r.submitted_at,
            r.decided_at,
            r.comment
        FROM episode_reviews r
        WHERE r.tenant_id = el.tenant_id
            AND r.episode_id = el.episode_id
        ORDER BY r.submitted_at DESC,
            r.id DESC
        LIMIT 1
    ) latest
WHERE el.tenant_id = sqlc.arg('tenant_id')
    AND el.episode_id = ANY (sqlc.arg('episode_ids')::uuid [])
    AND el.review_state IS NOT NULL;

-- name: CountInReviewEpisodesForTenant :one
SELECT COUNT(*)::int4
FROM episode_listings
WHERE tenant_id = $1
    AND status = 'scheduled'
    AND review_state = 'in_review';

-- name: GetReturnedEpisodeReviewNotice :one
-- Worker read: what the notice of a returned round says, and who it goes to.
-- The submitter is told only while they are still an active member of the
-- tenant's staff, the people the console's bell and the episode screen are
-- for; a round opened in no one's name, or by an account deleted or removed
-- from the staff since, answers a row with no recipient.
SELECT r.comment,
    e.public_id AS episode_public_id,
    et.title AS episode_title,
    s.public_id AS series_public_id,
    str.title AS series_title,
    recipient.id AS recipient_user_id,
    recipient.email AS recipient_email
FROM episode_reviews r
    JOIN episodes e ON e.tenant_id = r.tenant_id
        AND e.id = r.episode_id
    CROSS JOIN LATERAL episode_translation_for(e.id, '') et
    JOIN series s ON s.tenant_id = e.tenant_id
        AND s.id = e.series_id
    CROSS JOIN LATERAL series_translation_for(s.id, '') str
    LEFT JOIN users recipient ON recipient.tenant_id = r.tenant_id
        AND recipient.id = r.submitted_by_user_id
        AND (recipient.status)::text = 'active'
        AND EXISTS (
            SELECT 1
            FROM tenant_user_roles tur
            WHERE tur.tenant_id = recipient.tenant_id
                AND tur.user_id = recipient.id
        )
WHERE r.tenant_id = sqlc.arg('tenant_id')
    AND r.id = sqlc.arg('id')
    AND r.decision = 'returned';
