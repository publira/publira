-- Outbox queries. Producers insert a pending row in the
-- same transaction as the domain write. The worker claims due rows,
-- runs the handler, and records done / retry / dead.
--
-- Auth-mail payloads carry the raw token the token tables store only
-- as a hash, and the *_request events carry what a stranger typed into
-- a form: the address, and for a sign-up the name, the birth date, and
-- the password hash of the account it may open. Terminal updates drop
-- those keys on the event types below so a processed row keeps neither
-- a usable secret nor the form's contents. Other event types keep
-- payload.token, if they have one. Keep this list in
-- sync with MarkOutboxEventDone, MarkOutboxEventDead, both halves
-- of the stale reclaim (RecoverStaleProcessingOutboxEvents excludes the
-- list, RecoverStaleProcessingAuthMailOutboxEvents selects it), and
-- RequeueDeadOutboxEvents, which leaves these types dead. The
-- terminal-token data migration covers the types that existed when it
-- ran:
--   admin_email_change_confirmation_email
--   admin_password_reset_email
--   admin_password_reset_request
--   platform_email_change_confirmation_email
--   platform_password_reset_email
--   platform_password_reset_request
--   reader_email_change_confirmation_email
--   reader_email_verification_email
--   reader_email_verification_request
--   reader_password_reset_email
--   reader_password_reset_request
--   reader_signup_request
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
-- dropped and the rest of the payload stays for diagnosis. A reader
-- request loses the form's contents the same way. Other
-- event types are left alone. The plaintext window is the
-- pending/processing lifetime. Retries keep the token so a later
-- attempt can still send the mail, so that window is the retry budget
-- (sixteen attempts by default, delays doubling from 1s and capped at
-- 1h, about four hours), or the token's own lifetime where that is
-- shorter: a handler that finds the token expired finishes the event
-- without sending it. A worker that dies mid-attempt records no
-- failure, so
-- RecoverStaleProcessingAuthMailOutboxEvents charges the reclaim to
-- the same budget and every window ends here.
--
-- A finished event has nowhere left to resume from, so its progress
-- cursor goes too: a paged handler's cursor names one of the rows it
-- walked, which the event has no reason to keep once it is done.
-- name: MarkOutboxEventDone :one
UPDATE outbox_events
SET
    status = 'done',
    last_error = NULL,
    progress_cursor = NULL,
    payload = CASE
        WHEN event_type IN (
            'admin_email_change_confirmation_email',
            'admin_password_reset_email',
            'admin_password_reset_request',
            'platform_email_change_confirmation_email',
            'platform_password_reset_email',
            'platform_password_reset_request',
            'reader_email_change_confirmation_email',
            'reader_email_verification_email',
            'reader_email_verification_request',
            'reader_password_reset_email',
            'reader_password_reset_request',
            'reader_signup_request',
            'tenant_admin_invitation_email'
        ) THEN payload - '{token,password_hash,email,name,birth_date}'::text[]
        ELSE payload
    END,
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- Complete an event whose producer did the work itself before the
-- worker ever claimed it. The cache invalidation is the one that does:
-- the API server attempts the drop as soon as the write commits, and
-- marks the row done so the worker does not send the same tags a
-- second time. A row already claimed matches nothing here and is left
-- to the worker, which is the honest outcome of that race.
--
-- No token is dropped from payload: this statement is only for an
-- event whose payload holds no secret. An auth-mail event reaches its
-- terminal update through MarkOutboxEventDone, which strips it.
-- name: MarkPendingOutboxEventDone :one
UPDATE outbox_events
SET
    status = 'done',
    last_error = NULL,
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'pending'
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

-- A paged handler records how far it has got after each page, so a run
-- that ends before the event is finished leaves the next one a place to
-- resume from. Only the run that holds the claim may move it.
-- name: RecordOutboxEventProgress :execrows
UPDATE outbox_events
SET
    progress_cursor = sqlc.arg('progress_cursor'),
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing';

-- Hand an event back after a run that made progress and has more to do.
-- It is due at once and charges no attempt: the retry budget is for
-- failures, and an event large enough to need many runs is not failing.
-- name: ResumeOutboxEvent :one
UPDATE outbox_events
SET
    status = 'pending',
    available_at = NOW(),
    updated_at = NOW()
WHERE id = sqlc.arg('id')
    AND status = 'processing'
RETURNING *;

-- Hand back an event whose type this worker has no handler for, so that a
-- worker of a newer release, which writes the type, claims it later. Like
-- ResumeOutboxEvent it charges no attempt: nothing failed, and the worker
-- that handles the type starts on the whole retry budget. The payload keeps
-- any token, as a retry does, until that worker finishes the event or the
-- worker gives the type up and marks the event dead.
-- name: DeferOutboxEvent :one
UPDATE outbox_events
SET
    status = 'pending',
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
            'admin_password_reset_request',
            'platform_email_change_confirmation_email',
            'platform_password_reset_email',
            'platform_password_reset_request',
            'reader_email_change_confirmation_email',
            'reader_email_verification_email',
            'reader_email_verification_request',
            'reader_password_reset_email',
            'reader_password_reset_request',
            'reader_signup_request',
            'tenant_admin_invitation_email'
        ) THEN payload - '{token,password_hash,email,name,birth_date}'::text[]
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
        'admin_password_reset_request',
        'platform_email_change_confirmation_email',
        'platform_password_reset_email',
        'platform_password_reset_request',
        'reader_email_change_confirmation_email',
        'reader_email_verification_email',
        'reader_email_verification_request',
        'reader_password_reset_email',
        'reader_password_reset_request',
        'reader_signup_request',
        'tenant_admin_invitation_email'
    )
RETURNING *;

-- The same reclaim for the events whose payload holds a secret. A crash
-- records no failure, so an event whose worker dies on every attempt would
-- be re-queued forever and never reach the terminal update that drops the
-- secret. The reclaim therefore counts as a failed attempt, and the one that
-- exhausts max_attempts marks the row dead and strips the secret exactly as
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
        WHEN attempts + 1 >= sqlc.arg('max_attempts') THEN payload - '{token,password_hash,email,name,birth_date}'::text[]
        ELSE payload
    END,
    available_at = NOW(),
    updated_at = NOW()
WHERE status = 'processing'
    AND updated_at <= sqlc.arg('stale_before')
    AND event_type IN (
        'admin_email_change_confirmation_email',
        'admin_password_reset_email',
        'admin_password_reset_request',
        'platform_email_change_confirmation_email',
        'platform_password_reset_email',
        'platform_password_reset_request',
        'reader_email_change_confirmation_email',
        'reader_email_verification_email',
        'reader_email_verification_request',
        'reader_password_reset_email',
        'reader_password_reset_request',
        'reader_signup_request',
        'tenant_admin_invitation_email'
    )
RETURNING *;

-- The dead events, newest first, with the public ID of the tenant each
-- belongs to, for an operator choosing what to requeue. Every filter is
-- optional; one left NULL matches every row.
-- name: ListDeadOutboxEvents :many
SELECT
    o.id,
    o.event_type,
    t.public_id AS tenant_public_id,
    o.attempts,
    o.last_error,
    o.created_at,
    o.updated_at
FROM outbox_events AS o
LEFT JOIN tenants AS t ON t.id = o.tenant_id
WHERE o.status = 'dead'
    AND (sqlc.narg('id')::uuid IS NULL OR o.id = sqlc.narg('id'))
    AND (sqlc.narg('event_type')::text IS NULL OR o.event_type = sqlc.narg('event_type'))
    AND (sqlc.narg('tenant_id')::uuid IS NULL OR o.tenant_id = sqlc.narg('tenant_id'))
ORDER BY o.updated_at DESC, o.id DESC
LIMIT sqlc.arg('limit');

-- Return dead events to the queue on an operator's word, once whatever
-- failed them has been fixed. Each starts on the whole retry budget
-- again and is due at once; last_error stays until the next attempt
-- replaces it or the event finishes. Every filter is optional, as in
-- ListDeadOutboxEvents.
--
-- Two kinds stay dead. The auth-mail and request types lost their token
-- and the form's contents on the update that killed them, so there is
-- nothing left to send: the reader asks for a new mail. A
-- webhook_delivery is resent by the tenant's own console
-- (ResendWebhookDelivery), which queues a new event and keeps the
-- delivery's record of the attempts; requeuing the dead one beside it
-- would send the same delivery twice.
-- name: RequeueDeadOutboxEvents :many
UPDATE outbox_events
SET
    status = 'pending',
    attempts = 0,
    available_at = NOW(),
    updated_at = NOW()
WHERE status = 'dead'
    AND (sqlc.narg('id')::uuid IS NULL OR id = sqlc.narg('id'))
    AND (sqlc.narg('event_type')::text IS NULL OR event_type = sqlc.narg('event_type'))
    AND (sqlc.narg('tenant_id')::uuid IS NULL OR tenant_id = sqlc.narg('tenant_id'))
    AND event_type NOT IN (
        'admin_email_change_confirmation_email',
        'admin_password_reset_email',
        'admin_password_reset_request',
        'platform_email_change_confirmation_email',
        'platform_password_reset_email',
        'platform_password_reset_request',
        'reader_email_change_confirmation_email',
        'reader_email_verification_email',
        'reader_email_verification_request',
        'reader_password_reset_email',
        'reader_password_reset_request',
        'reader_signup_request',
        'tenant_admin_invitation_email',
        'webhook_delivery'
    )
RETURNING *;
