-- Outbox queries. Producers insert a pending row in the
-- same transaction as the domain write. The worker claims due rows,
-- runs the handler, and records done / retry / dead.
--
-- Auth-mail payloads carry the raw token the token tables store only
-- as a hash. Terminal updates drop that key on the event types below
-- so a processed row does not keep a usable secret. Other event types
-- keep payload.token, if they have one. Keep this list in sync with
-- MarkOutboxEventDone, MarkOutboxEventDead, both halves of the stale
-- reclaim (RecoverStaleProcessingOutboxEvents excludes the list,
-- RecoverStaleProcessingAuthMailOutboxEvents selects it), and the
-- terminal-token data migration:
--   admin_email_change_confirmation_email
--   admin_password_reset_email
--   platform_email_change_confirmation_email
--   platform_password_reset_email
--   reader_email_change_confirmation_email
--   reader_email_verification_email
--   reader_password_reset_email
--   tenant_admin_invitation_email
--
-- Expected plans (empty table may still seq-scan; SET enable_seqscan = off
-- in the integration test to confirm the index is eligible):
--   ClaimPendingOutboxEvents
--     -> idx_outbox_events_pending_available_at
--   GetOutboxEventByIdempotencyKey
--     -> outbox_events_idempotency_key_key

-- Worker insert. Same idempotency_key is a no-op so retries of the
-- producing transaction do not create a second row. :one returns no
-- rows on conflict.
-- name: InsertOutboxEvent :one
INSERT INTO outbox_events (
    id,
    tenant_id,
    event_type,
    payload,
    idempotency_key,
    available_at
)
VALUES (
    sqlc.arg('id'),
    sqlc.narg('tenant_id'),
    sqlc.arg('event_type'),
    sqlc.arg('payload'),
    sqlc.arg('idempotency_key'),
    sqlc.arg('available_at')
)
ON CONFLICT (idempotency_key) DO NOTHING
RETURNING *;

-- name: GetOutboxEvent :one
SELECT *
FROM outbox_events
WHERE id = sqlc.arg('id');

-- name: GetOutboxEventByIdempotencyKey :one
SELECT *
FROM outbox_events
WHERE idempotency_key = sqlc.arg('idempotency_key');

-- Claim the next due pending rows. SKIP LOCKED lets concurrent workers
-- drain without waiting on each other's locks. The CTE is required:
-- FOR UPDATE is not allowed in an IN subquery.
-- name: ClaimPendingOutboxEvents :many
WITH claim AS (
    SELECT id
    FROM outbox_events
    WHERE status = 'pending'
        AND available_at <= NOW()
    ORDER BY available_at ASC, id ASC
    LIMIT sqlc.arg('limit')
    FOR UPDATE SKIP LOCKED
)
UPDATE outbox_events AS o
SET
    status = 'processing',
    updated_at = NOW()
FROM claim
WHERE o.id = claim.id
RETURNING o.*;

-- Auth mail is the one place the raw token still has to appear: the
-- token tables store a hash, so the producing transaction writes the
-- secret into payload for the worker to render. Once an auth-mail
-- event is terminal the worker no longer needs it, so the key is
-- dropped and the rest of the payload stays for diagnosis. Other
-- event types are left alone. The plaintext window is the
-- pending/processing lifetime. Retries keep the token so a later
-- attempt can still send the mail, so that window is the retry budget
-- (ten attempts, delays doubling from 1s and capped at 1h). A worker
-- that dies mid-attempt records no failure, so
-- RecoverStaleProcessingAuthMailOutboxEvents charges the reclaim to
-- the same budget and every window ends here.
-- name: MarkOutboxEventDone :one
UPDATE outbox_events
SET
    status = 'done',
    last_error = NULL,
    payload = CASE
        WHEN event_type IN (
            'admin_email_change_confirmation_email',
            'admin_password_reset_email',
            'platform_email_change_confirmation_email',
            'platform_password_reset_email',
            'reader_email_change_confirmation_email',
            'reader_email_verification_email',
            'reader_password_reset_email',
            'tenant_admin_invitation_email'
        ) THEN payload - 'token'
        ELSE payload
    END,
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- name: MarkOutboxEventRetry :one
UPDATE outbox_events
SET
    status = 'pending',
    attempts = attempts + 1,
    available_at = sqlc.arg('available_at'),
    last_error = sqlc.narg('last_error'),
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- Same token drop as MarkOutboxEventDone: a dead auth-mail event is
-- as terminal as a successful one, and the secret is no longer
-- needed to send the mail.
-- name: MarkOutboxEventDead :one
UPDATE outbox_events
SET
    status = 'dead',
    attempts = attempts + 1,
    last_error = sqlc.narg('last_error'),
    payload = CASE
        WHEN event_type IN (
            'admin_email_change_confirmation_email',
            'admin_password_reset_email',
            'platform_email_change_confirmation_email',
            'platform_password_reset_email',
            'reader_email_change_confirmation_email',
            'reader_email_verification_email',
            'reader_password_reset_email',
            'tenant_admin_invitation_email'
        ) THEN payload - 'token'
        ELSE payload
    END,
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- Release a claim when River already has an in-flight process job for
-- this event (unique skip). attempts and available_at stay as they were.
-- name: UnclaimOutboxEvent :one
UPDATE outbox_events
SET
    status = 'pending',
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- Re-queue rows left in processing after a worker crash. updated_at is the
-- claim time; callers pass now minus the stale-processing grace period.
-- Auth-mail types are excluded here and reclaimed by
-- RecoverStaleProcessingAuthMailOutboxEvents instead: they are the ones
-- holding a secret, and only they pay for the reclaim. A crash loop costs
-- these rows no retry budget.
-- name: RecoverStaleProcessingOutboxEvents :many
UPDATE outbox_events
SET
    status = 'pending',
    available_at = NOW(),
    updated_at = NOW()
WHERE status = 'processing'
    AND updated_at <= sqlc.arg('stale_before')
    AND event_type NOT IN (
        'admin_email_change_confirmation_email',
        'admin_password_reset_email',
        'platform_email_change_confirmation_email',
        'platform_password_reset_email',
        'reader_email_change_confirmation_email',
        'reader_email_verification_email',
        'reader_password_reset_email',
        'tenant_admin_invitation_email'
    )
RETURNING *;

-- The same reclaim for the events whose payload holds a raw token. A crash
-- records no failure, so an event whose worker dies on every attempt would
-- be re-queued forever and never reach the terminal update that drops the
-- token. The reclaim therefore counts as a failed attempt, and the one that
-- exhausts max_attempts marks the row dead and strips the token exactly as
-- MarkOutboxEventDead does. The plaintext window is bounded by max_attempts
-- reclaims of the stale-processing grace period.
-- name: RecoverStaleProcessingAuthMailOutboxEvents :many
UPDATE outbox_events
SET
    status = CASE
        WHEN attempts + 1 >= sqlc.arg('max_attempts') THEN 'dead'
        ELSE 'pending'
    END,
    attempts = attempts + 1,
    last_error = sqlc.arg('last_error'),
    payload = CASE
        WHEN attempts + 1 >= sqlc.arg('max_attempts') THEN payload - 'token'
        ELSE payload
    END,
    available_at = NOW(),
    updated_at = NOW()
WHERE status = 'processing'
    AND updated_at <= sqlc.arg('stale_before')
    AND event_type IN (
        'admin_email_change_confirmation_email',
        'admin_password_reset_email',
        'platform_email_change_confirmation_email',
        'platform_password_reset_email',
        'reader_email_change_confirmation_email',
        'reader_email_verification_email',
        'reader_password_reset_email',
        'tenant_admin_invitation_email'
    )
RETURNING *;
